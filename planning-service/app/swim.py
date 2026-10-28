"""The FAA's SWIM feeds, read as they come (the owner's SCDS subscriptions,
2026-10-19). STDDS's terminal radar tracks -- TAIS, every STARS facility's
tracks with each airplane's Mode S address, its beacon code, its reported
altitude and, where it has one, its flight plan -- given to vfr.traffic as
reports heard elsewhere. That puts on the map the airplanes no ADS-B
network hears (N3429J, a UAT airplane adsb.lol never had), and records
the flights of the airplanes a pilot follows from takeoff, card open or
not, since adsb.lol's history closed behind a browser check. FNS's
NOTAMs -- each as the NOTAM System issues, replaces or cancels it --
given to vfr.notams to keep. TFMS's flight data -- the NAS's flight plans
and their amendments, each flight's route of flight -- given to
vfr.filed_routes, which counts the routes pilots file between two fields.

The reading is done in a process of its own (app.swim_reader): one
connection a feed to its subscription's durable queue, each message read,
the radar's tracks picked out, then acknowledged. Here a thread of the
planner's sends that process what the map looks at and who is followed,
hands what comes back to vfr, and starts the process again after a pause
where it ends. A feed is off where its SWIM_* settings are not all set;
a dropped connection is made again after a pause, growing to a few
minutes.
"""
import logging
import multiprocessing
import queue
import threading
import time

from vfr import filed_routes, notams, traffic

from . import swim_reader
# The reading's pure parts, here as well for the planner's own use and its tests.
from .swim_reader import (  # noqa: F401
    FACILITY_SPAN_NM, FEEDS, RETRY_FIRST_S, RETRY_MOST_S, SETTINGS, VIEW_MARGIN_NM,
    _host, _in_view, _nm, body, configured, raw, tracks,
)

log = logging.getLogger(__name__)

#: Each feed's messages read so far, what they gave (tracks, NOTAMs) and
#: when the last came: the Dev console's and a test's view of it.
STATE = {feed: {"connected": False, "messages": 0, "items": 0, "last_at": None, "error": None} for feed in FEEDS}
#: How often the reading process is sent what the map looks at, s: the
#: map asks for traffic every few seconds, so a second behind is in time.
WANTED_EVERY_S = 1.0


def _radar(text: str) -> int:
    """A radar message's tracks handed to vfr.traffic, in this process: the
    airplanes round the places the map shows traffic, and the followed ones
    wherever they are (swim_reader.select)."""
    found = swim_reader.select(text, *traffic.radar_wanted())
    for plane, at in found:
        traffic.heard_elsewhere(plane, at)
    return len(found)


#: What each feed's messages are handed to; each gives how many items it read.
HANDLERS = {"STDDS": _radar, "FNS": notams.heard, "TFMS": filed_routes.heard}


def dispatch(kind: str, feed: str, value) -> None:
    """One thing the reading process sent, handed on: a radar message's
    kept tracks to vfr.traffic, a NOTAM or flight plan message to its
    feed's handler, and a feed's connection and counts into STATE."""
    state = STATE[feed]
    if kind == "radar":
        for plane, at in value:
            traffic.heard_elsewhere(plane, at)
        state["items"] += len(value)
    elif kind == "text":
        state["items"] += HANDLERS[feed](value)
    elif kind == "state":
        # The reading process logs its own failures; its connecting is told here.
        if value.get("connected") and not state["connected"]:
            log.info("SWIM %s connected", feed)
        state.update(value)


def _serve(feeds: list[str]) -> None:
    """The reading process kept going: started, sent what is wanted as it
    changes, what it sends handed on, and started again after a pause
    where it ends (the pause growing as a connection's does). Spawned, not
    forked: a fork of the planner would copy its threads' locks mid-use."""
    context = multiprocessing.get_context("spawn")
    pause = RETRY_FIRST_S
    while True:
        out = context.Queue()
        wanted_in, wanted_out = context.Pipe(duplex=False)
        process = context.Process(target=swim_reader.main, args=(feeds, out, wanted_in), name="swim-reader", daemon=True)
        process.start()
        # Only the process holds the reading end, so it sees this one close.
        wanted_in.close()
        started = time.monotonic()
        log.info("SWIM reader started (pid %d) for %s", process.pid, ", ".join(feeds))
        sent, sent_at = None, 0.0
        while process.is_alive():
            if time.monotonic() - sent_at >= WANTED_EVERY_S:
                sent_at = time.monotonic()
                wanted = traffic.radar_wanted()
                if wanted != sent:
                    try:
                        wanted_out.send(wanted)
                        sent = wanted
                    except OSError:
                        break
            try:
                kind, feed, value = out.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                dispatch(kind, feed, value)
            except Exception:  # noqa: BLE001 -- one message must not end the reading
                log.warning("SWIM %s: %s not handed on", feed, kind, exc_info=True)
        log.warning("SWIM reader ended (exit code %s); starting it again in %.0f s", process.exitcode, pause)
        for feed in feeds:
            STATE[feed].update(connected=False, error=f"reader process ended (exit code {process.exitcode})")
        wanted_out.close()
        out.close()
        # A process that ran a while ended by chance: the next starts soon.
        if time.monotonic() - started > RETRY_MOST_S:
            pause = RETRY_FIRST_S
        time.sleep(pause)
        pause = min(RETRY_MOST_S, pause * 2)


def start() -> None:
    """The reading process started, for the feeds that are set up."""
    feeds = [feed for feed in FEEDS if configured(feed)]
    if feeds:
        threading.Thread(target=_serve, args=(feeds,), name="swim", daemon=True).start()
