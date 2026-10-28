"""The FAA's SWIM feeds' reading, in a process of its own (app.swim starts
it): each configured feed's connection on a thread, its messages read,
the radar's tracks picked out and every message acknowledged here, and
only what the planner keeps sent on to it. The Solace client's reading
of a payload and its acknowledgement, and the radar's parsing, took most
of a core at STDDS's 370 messages a second (py-spy, 2026-10-28), all of
it holding the planner's GIL against the route planning a pilot waits
on; a process of its own has a GIL of its own.

So it imports nothing of vfr's, nor pandas: a spawned process starts by
importing this module, and starts in a moment and small.
"""
import logging
import math
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime

log = logging.getLogger(__name__)

#: What every connection needs, and each feed's own (its VPN and queue),
#: from the subscription's Details page.
SETTINGS = ("SWIM_HOST", "SWIM_USERNAME", "SWIM_PASSWORD")
FEEDS = ("STDDS", "FNS", "TFMS")
#: The CA certificates the FAA's broker's certificate is checked against:
#: the image's own (python:3.13-slim's ca-certificates).
TRUST_STORE = os.environ.get("SWIM_TRUST_STORE", "/etc/ssl/certs")
#: How long to wait before connecting again, s, doubling to the most.
RETRY_FIRST_S, RETRY_MOST_S = 10.0, 300.0


def _settings(feed: str) -> tuple[str, ...]:
    return (*SETTINGS, f"SWIM_VPN_{feed}", f"SWIM_QUEUE_{feed}")


def _host(feed: str) -> str:
    """The broker a feed's subscription is on: its own where SCDS put it
    on another (TFMS's on ems1, the others' on ems2), else the shared one."""
    return os.environ.get(f"SWIM_HOST_{feed}") or os.environ["SWIM_HOST"]


def configured(feed: str) -> bool:
    return all(os.environ.get(name) for name in _settings(feed))


def _number(element, tag: str) -> float | None:
    text = element.findtext(tag)
    try:
        return float(text) if text not in (None, "") else None
    except ValueError:
        return None


def _when(text: str | None) -> float | None:
    """An ISO time as the feed writes it ("2026-10-20T01:58:25.921Z"), s."""
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def body(message) -> str:
    """A message's text, read from its bytes first: the client raises on
    some of the feed's messages when asked for a string, and one message
    it can't read must not drop the connection. Empty where neither reads."""
    for read in (message.get_payload_as_bytes, message.get_payload_as_string):
        try:
            payload = read()
        except Exception:  # noqa: BLE001 -- the client's error for a payload of the other kind
            continue
        if payload:
            return payload.decode("utf-8", "replace") if isinstance(payload, (bytes, bytearray)) else payload
    return ""


def tracks(xml: str) -> list[tuple[dict, float]]:
    """A TATrackAndFlightPlan message's airborne tracks, each as vfr.traffic's
    `_aircraft` gives an airplane, and when it was where it is (s): the
    track's Mode S address (`acAddress`), its place, its altitude as the
    transponder reports it (pressure altitude, to the hundred feet), its
    speed and track from its ground velocity (vx, vy, knots east and north;
    STARS's TAIS interface), its climb (vVert, ft/min) and its beacon code;
    the flight plan's ident and type where the track has one. None for a
    track with no address, one coasting or dropped, or on the surface."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    if not root.tag.endswith("TATrackAndFlightPlan"):
        return []
    out = []
    for record in root.iter("record"):
        track = record.find("track")
        if track is None or track.findtext("status") != "active":
            continue
        address = (track.findtext("acAddress") or "").strip().lower()
        lat, lon = _number(track, "lat"), _number(track, "lon")
        at = _when(track.findtext("mrtTime"))
        # "000000" is no address: a target with no Mode S transponder.
        if len(address) != 6 or address == "000000" or lat is None or lon is None or at is None:
            continue
        vx, vy = _number(track, "vx"), _number(track, "vy")
        plan = record.find("flightPlan")
        ident = (plan.findtext("acid") or "").strip() if plan is not None else ""
        kind = (plan.findtext("acType") or "").strip() if plan is not None else ""
        squawk = (track.findtext("reportedBeaconCode") or "").strip()
        out.append(({
            "hex": address,
            "callsign": ident or None,
            "registration": ident if ident.startswith("N") else None,
            "type": kind or None,
            "lat": round(lat, 5), "lon": round(lon, 5),
            "altitude_ft": _number(track, "reportedAltitude"),
            "pressure_altitude": True,
            "track_deg": round(math.degrees(math.atan2(vx, vy)) % 360, 1) if vx is not None and vy is not None else None,
            "speed_kt": round(math.hypot(vx, vy), 1) if vx is not None and vy is not None else None,
            "vertical_fpm": _number(track, "vVert"),
            "seen_s": None,
            "squawk": squawk or None,
            # 7500 unlawful interference (AIM 6-3-4), 7600 radio failure
            # (AIM 6-4-2), 7700 emergency (AIM 6-2-2).
            "emergency": {"7500": "unlawful", "7600": "nordo", "7700": "general"}.get(squawk),
            "category": None,
        }, at))
    return out


#: How far a facility's tracks can lie from one another, nm: one STARS
#: facility's message holds the tracks of its own radars, 60 nm round each
#: terminal radar (the ASR-9's and ASR-11's instrumented range, FAA
#: surveillance radar fact sheets) and the long-range ARSR some facilities
#: fuse in, so its first track is taken to say where all of them are to
#: within this much.
FACILITY_SPAN_NM = 200.0
#: How far past a view's edge its airplanes are still kept, nm: about a
#: minute of a fast airplane's flying, so one about to come in is there.
VIEW_MARGIN_NM = 10.0
_FIRST_PLACE = re.compile(r"<lat>(-?[\d.]+)</lat><lon>(-?[\d.]+)</lon>")


def _nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """About how far apart two places are, nm, on a flat chart a minute of
    latitude to the mile: near enough to say a facility is out of sight
    with hundreds of miles to spare, and cheap enough for every message."""
    return 60.0 * math.hypot(lat2 - lat1, (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)))


def _in_view(lat: float, lon: float, views, margin: float) -> bool:
    return any(_nm(lat, lon, v_lat, v_lon) <= radius + margin for v_lat, v_lon, radius in views)


def raw(message) -> bytes | str:
    """A message's bytes as they came, for a handler that looks in them
    before it decodes them (RAW); its text where the client has no bytes."""
    try:
        payload = message.get_payload_as_bytes()
    except Exception:  # noqa: BLE001 -- the client's error for a payload of the other kind
        payload = None
    return payload if payload else body(message)



def select(text: str, views, followed) -> list[tuple[dict, float]]:
    """A radar message's tracks worth keeping: the airplanes round the
    places the map shows traffic (`views`, each (lat, lon, radius nm)), and
    the followed ones (`followed`, their addresses) wherever they are. A
    message from a facility far from every view and naming no followed
    airplane is not parsed at all, which is most of them: the country's
    tracks, parsed as they come, took the planner's time from the planning
    a pilot waits on."""
    if "TATrackAndFlightPlan" not in text[:300]:
        return []
    first = _FIRST_PLACE.search(text)
    near = first is not None and _in_view(float(first[1]), float(first[2]), views, FACILITY_SPAN_NM)
    if not near and not any(a in text or a.upper() in text for a in followed):
        return []
    return [
        (plane, at) for plane, at in tracks(text)
        if plane["hex"] in followed or _in_view(plane["lat"], plane["lon"], views, VIEW_MARGIN_NM)
    ]


#: The feeds whose messages go to the planner as their bytes
#: (vfr.filed_routes.heard looks in them before it decodes them).
RAW = {"TFMS"}
#: How often a feed's count of messages goes to the planner at most, s:
#: the Dev console's figures, not worth a message of their own each.
STATE_EVERY_S = 1.0


def _run(feed: str, out, wanted: list) -> None:
    """Connect, read and send on until the process ends, connecting again
    after a pause where the connection drops or cannot be made. What goes
    to the planner, on `out`: ("radar", feed, tracks) with a radar
    message's kept tracks, ("text", feed, payload) with each NOTAM or
    flight plan message, and ("state", feed, fields) with the feed's
    connection and counts. `wanted` holds the planner's latest (views,
    followed), the radar's tracks picked against it."""
    from solace.messaging.config.retry_strategy import RetryStrategy
    from solace.messaging.config.transport_security_strategy import TLS
    from solace.messaging.messaging_service import MessagingService
    from solace.messaging.resources.queue import Queue

    pause = RETRY_FIRST_S
    messages = 0
    while True:
        service = receiver = None
        try:
            service = (MessagingService.builder().from_properties({
                "solace.messaging.transport.host": _host(feed),
                "solace.messaging.service.vpn-name": os.environ[f"SWIM_VPN_{feed}"],
                "solace.messaging.authentication.scheme.basic.username": os.environ["SWIM_USERNAME"],
                "solace.messaging.authentication.scheme.basic.password": os.environ["SWIM_PASSWORD"],
            }).with_transport_security_strategy(
                # The FAA's certificate checked against the image's own CAs.
                TLS.create().with_certificate_validation(True, validate_server_name=True, trust_store_file_path=TRUST_STORE))
                .with_reconnection_retry_strategy(RetryStrategy.parametrized_retry(5, 3000)).build())
            service.connect()
            receiver = service.create_persistent_message_receiver_builder().build(
                Queue.durable_exclusive_queue(os.environ[f"SWIM_QUEUE_{feed}"]))
            receiver.start()
            out.put(("state", feed, {"connected": True, "error": None}))
            pause = RETRY_FIRST_S
            sent_at = 0.0
            while True:
                message = receiver.receive_message(timeout=5000)
                if message is None:
                    continue
                if feed == "STDDS":
                    found = select(body(message), *wanted[0])
                    if found:
                        out.put(("radar", feed, found))
                else:
                    out.put(("text", feed, raw(message) if feed in RAW else body(message)))
                messages += 1
                receiver.ack(message)
                now = time.time()
                if now - sent_at >= STATE_EVERY_S:
                    out.put(("state", feed, {"messages": messages, "last_at": now}))
                    sent_at = now
        except Exception as err:  # noqa: BLE001 -- any failure: connect again after the pause
            error = f"{type(err).__name__}: {str(err)[:200]}"
            out.put(("state", feed, {"connected": False, "error": error, "messages": messages}))
            log.warning("SWIM %s: %s; connecting again in %.0f s", feed, error, pause)
        finally:
            for closing in (receiver, service):
                try:
                    if closing is receiver and closing is not None:
                        closing.terminate()
                    elif closing is not None:
                        closing.disconnect()
                except Exception:  # noqa: BLE001 -- already gone
                    pass
        time.sleep(pause)
        pause = min(RETRY_MOST_S, pause * 2)


def main(feeds, out, wanted_in) -> None:
    """The process: each feed read on a thread of its own, while this one
    takes the planner's (views, followed) as they change. It ends when the
    planner does: the planner's end of `wanted_in` closes with it, however
    it ended, and the reading cannot go on without the planner to send to."""
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    wanted = [([], set())]
    for feed in feeds:
        threading.Thread(target=_run, args=(feed, out, wanted), name=f"swim-{feed.lower()}", daemon=True).start()
    while True:
        try:
            wanted[0] = wanted_in.recv()
        except (EOFError, OSError):
            os._exit(0)
