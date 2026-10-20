"""The FAA's SWIM feeds, read as they come (the owner's SCDS subscriptions,
2026-10-19): STDDS's terminal radar tracks -- TAIS, every STARS facility's
tracks with each airplane's Mode S address, its beacon code, its reported
altitude and, where it has one, its flight plan -- given to vfr.traffic as
reports heard elsewhere. That puts on the map the airplanes no ADS-B
network hears (N3429J, a UAT airplane adsb.lol never had), and records
the flights of the airplanes a pilot follows from takeoff, card open or
not, since adsb.lol's history closed behind a browser check.

One connection, on a thread of its own, to the subscription's durable
queue: each message read, its tracks handed on, then acknowledged. Off
where the SWIM_* settings are not all set; a dropped connection is made
again after a pause, growing to a few minutes.
"""
import logging
import math
import os
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime

from vfr import traffic

log = logging.getLogger(__name__)

#: What the STDDS connection needs, from the subscription's Details page.
SETTINGS = ("SWIM_HOST", "SWIM_USERNAME", "SWIM_PASSWORD", "SWIM_VPN_STDDS", "SWIM_QUEUE_STDDS")
#: The CA certificates the FAA's broker's certificate is checked against:
#: the image's own (python:3.13-slim's ca-certificates).
TRUST_STORE = os.environ.get("SWIM_TRUST_STORE", "/etc/ssl/certs")
#: How long to wait before connecting again, s, doubling to the most.
RETRY_FIRST_S, RETRY_MOST_S = 10.0, 300.0
#: How many messages read so far, and when the last came: the Dev console's
#: and a test's view of the feed.
STATE = {"connected": False, "messages": 0, "tracks": 0, "last_at": None, "error": None}


def configured() -> bool:
    return all(os.environ.get(name) for name in SETTINGS)


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
            "emergency": {"7500": "unlawful", "7600": "nordo", "7700": "general"}.get(squawk),
            "category": None,
        }, at))
    return out


def _run() -> None:
    """Connect, read and hand on until the process ends, connecting again
    after a pause where the connection drops or cannot be made."""
    from solace.messaging.config.retry_strategy import RetryStrategy
    from solace.messaging.config.transport_security_strategy import TLS
    from solace.messaging.messaging_service import MessagingService
    from solace.messaging.resources.queue import Queue

    pause = RETRY_FIRST_S
    while True:
        service = receiver = None
        try:
            service = (MessagingService.builder().from_properties({
                "solace.messaging.transport.host": os.environ["SWIM_HOST"],
                "solace.messaging.service.vpn-name": os.environ["SWIM_VPN_STDDS"],
                "solace.messaging.authentication.scheme.basic.username": os.environ["SWIM_USERNAME"],
                "solace.messaging.authentication.scheme.basic.password": os.environ["SWIM_PASSWORD"],
            }).with_transport_security_strategy(
                # The FAA's certificate checked against the image's own CAs.
                TLS.create().with_certificate_validation(True, validate_server_name=True, trust_store_file_path=TRUST_STORE))
                .with_reconnection_retry_strategy(RetryStrategy.parametrized_retry(5, 3000)).build())
            service.connect()
            receiver = service.create_persistent_message_receiver_builder().build(
                Queue.durable_exclusive_queue(os.environ["SWIM_QUEUE_STDDS"]))
            receiver.start()
            STATE.update(connected=True, error=None)
            pause = RETRY_FIRST_S
            log.info("SWIM STDDS connected")
            while True:
                message = receiver.receive_message(timeout=5000)
                if message is None:
                    continue
                text = body(message)
                found = tracks(text) if "TATrackAndFlightPlan" in text[:300] else []
                for plane, at in found:
                    traffic.heard_elsewhere(plane, at)
                STATE["messages"] += 1
                STATE["tracks"] += len(found)
                STATE["last_at"] = time.time()
                receiver.ack(message)
        except Exception as err:  # noqa: BLE001 -- any failure: connect again after the pause
            STATE.update(connected=False, error=f"{type(err).__name__}: {str(err)[:200]}")
            log.warning("SWIM STDDS: %s; connecting again in %.0f s", STATE["error"], pause)
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


def start() -> None:
    """The feed's reader started on its own thread, where it is set up."""
    if configured():
        threading.Thread(target=_run, name="swim-stdds", daemon=True).start()
