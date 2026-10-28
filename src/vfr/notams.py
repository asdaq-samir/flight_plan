"""NOTAMs from the FAA NOTAM System's own feed: SWIM's FNS (AIM's NOTAM
Distribution Service, AIXM 5.1 messages, the owner's SCDS subscription of
2026-10-19), each NOTAM as it is issued, replaced or cancelled.

Each message's Event carries one NOTAM: its location, number, effective
times, schedule and text, in the domestic form a briefing gives it
("!BJC 10/060 BJC SVC ...") where it has one, and in the ICAO form where
it is international ("A1645/26 NOTAMN Q) KZDV/..."). The two forms of one
NOTAM come as two messages; they are kept as one, by the domestic
number. A domestic NOTAM cancelled before its end comes again with its
feature lifetime ended (FNS scenario 1005); an ICAO one is ended by a
later NOTAM that names it ("A1644/26 NOTAMC A1643/26", or NOTAMR for a
replacement).

Kept in a SQLite file so a restart forgets none, each until a day after it
ends. The feed brings NOTAMs from the first connection on, never the ones
already in force: `since()` says when that was, and until a first load of
those (FNS's Initial Load) the store is not the whole list for a field.
Only the United States' own are kept: the feed sends the world's
international ones too.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from .config import DATA_DIR

STORE = Path(os.environ.get("NOTAM_STORE", str(DATA_DIR / "raw" / "faa_notams" / "notams.sqlite")))
#: How long an ended NOTAM is kept, s: a day, for a briefing read just after.
KEEP_ENDED_S = 24 * 3600

NS = {
    "event": "http://www.aixm.aero/schema/5.1/event",
    "gml": "http://www.opengis.net/gml/3.2",
    "aixm": "http://www.aixm.aero/schema/5.1",
    "fnse": "http://www.aixm.aero/schema/5.1/extensions/FAA/FNSE",
}
#: The ICAO location prefixes of the United States and its territories
#: (ICAO Doc 7910): the contiguous states K, Alaska PA-PP, Hawaii PH,
#: the Pacific islands PG/PK/PW..., Puerto Rico TJ, the Virgin Islands TI
#: and American Samoa NS (NSTU).
US_PREFIXES = ("K", "P", "TJ", "TI", "NS")
#: The ICAO form's number ("A1643/26"), and the one a NOTAMR or NOTAMC names.
_ICAO_ID = re.compile(r"\b([A-Z]\d{4}/\d{2})\s+NOTAM[NRC]\b(?:\s+([A-Z]\d{4}/\d{2}))?")
#: The domestic form's location and number ("!BJC 10/060").
_DOMESTIC_ID = re.compile(r"^!(\w+)\s+(\d{1,2}/\d{1,4})")

_LOCK = threading.Lock()
_db: sqlite3.Connection | None = None


def _connection() -> sqlite3.Connection:
    global _db
    if _db is None:
        STORE.parent.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(STORE, check_same_thread=False)
        _db.executescript("""
            CREATE TABLE IF NOT EXISTS notams (
                id TEXT PRIMARY KEY, icao_id TEXT, location TEXT, icao_location TEXT,
                classification TEXT, issued TEXT, starts TEXT, ends TEXT, estimated INTEGER,
                schedule TEXT, text TEXT, raw TEXT, ended INTEGER DEFAULT 0, heard REAL);
            CREATE INDEX IF NOT EXISTS notams_location ON notams (location);
            CREATE INDEX IF NOT EXISTS notams_icao_location ON notams (icao_location);
            CREATE INDEX IF NOT EXISTS notams_icao_id ON notams (icao_id);
            CREATE TABLE IF NOT EXISTS heard (since REAL);
        """)
    return _db


def reset() -> None:
    """The connection closed, for a test to point STORE at its own file."""
    global _db
    with _LOCK:
        if _db is not None:
            _db.close()
        _db = None


def _utc(text: str | None) -> tuple[str | None, bool]:
    """A NOTAM's effective time ("202610270700", "202610270700EST" where
    estimated, "PERM" for none) as ISO 8601 UTC, and whether estimated."""
    if not text or not text[:12].isdigit():
        return None, False
    when = datetime.strptime(text[:12], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
    return when.isoformat().replace("+00:00", "Z"), text.endswith("EST")


def _iso(text: str | None) -> str | None:
    """A gml time ("2026-10-20T02:03:26.000Z") to the minute, as _utc's."""
    if not text:
        return None
    try:
        when = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.replace(second=0, microsecond=0).isoformat().replace("+00:00", "Z")


def _stamp(now: float) -> str:
    """A moment as the store's times are written, to compare with them."""
    return datetime.fromtimestamp(int(now), timezone.utc).isoformat().replace("+00:00", "Z")


def notams(xml: str) -> list[dict]:
    """The NOTAMs of one FNS message, each {"id", "icao_id", "names",
    "type", "location", "icao_location", "classification", "issued",
    "starts", "ends", "estimated", "schedule", "text", "raw"}: `names` is
    the NOTAM a NOTAMR or NOTAMC ends. `ends` is the sooner of its own end
    and its feature lifetime's, for one cancelled early."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    out = []
    for event in root.iter(f"{{{NS['event']}}}EventTimeSlice"):
        notam = event.find("event:textNOTAM/event:NOTAM", NS)
        if notam is None:
            continue
        get = lambda tag: (notam.findtext(f"event:{tag}", namespaces=NS) or "").strip()  # noqa: E731
        domestic = icao = None
        for translation in notam.iterfind("event:translation/event:NOTAMTranslation", NS):
            kind = translation.findtext("event:type", namespaces=NS)
            if kind == "LOCAL_FORMAT":
                domestic = (translation.findtext("event:simpleText", namespaces=NS) or "").strip()
            elif kind == "OTHER:ICAO":
                formatted = translation.find("event:formattedText", NS)
                # Its words are an HTML div of a <pre>, escaped.
                icao = re.sub(r"</?pre>", "", "".join(formatted.itertext())).strip() if formatted is not None else None
        text = get("text")
        icao_match = _ICAO_ID.search(icao or text)
        series, number, year = get("series"), get("number"), get("year")
        icao_id = icao_match.group(1) if icao_match else (
            f"{series}{number.zfill(4)}/{year[-2:]}" if series and number and year else None)
        domestic_match = _DOMESTIC_ID.match(domestic or "")
        key = f"{domestic_match.group(1)} {domestic_match.group(2)}" if domestic_match else icao_id
        if not key:
            continue
        extension = event.find("event:extension/fnse:EventExtension", NS)
        ext = lambda tag: ((extension.findtext(f"fnse:{tag}", namespaces=NS) if extension is not None else None) or "").strip() or None  # noqa: E731
        starts, _ = _utc(get("effectiveStart"))
        ends, estimated = _utc(get("effectiveEnd"))
        lifetime = _iso(event.findtext("aixm:featureLifetime/gml:TimePeriod/gml:endPosition", namespaces=NS))
        if lifetime and (ends is None or lifetime < ends):
            ends, estimated = lifetime, False
        out.append({
            "id": key, "icao_id": icao_id,
            "names": icao_match.group(2) if icao_match and get("type") in ("R", "C") else None,
            "type": get("type") or None,
            "location": get("location") or None, "icao_location": ext("icaoLocation"),
            "classification": ext("classification"),
            "issued": _iso(get("issued")), "starts": starts, "ends": ends, "estimated": estimated,
            "schedule": get("schedule") or None,
            "text": text, "raw": domestic or icao or text,
        })
    return out


def _ours(notam: dict) -> bool:
    if notam["classification"] != "INTL":
        return True
    return any((place or "").startswith(US_PREFIXES) for place in (notam["location"], notam["icao_location"]))


def heard(xml: str, now: float | None = None) -> int:
    """One FNS message kept: its NOTAMs added or updated, the ones they
    replace or cancel ended, and those a day past their end let go.
    How many NOTAMs it gave."""
    now = time.time() if now is None else now
    found = [n for n in notams(xml) if _ours(n)]
    with _LOCK:
        db = _connection()
        if db.execute("SELECT 1 FROM heard").fetchone() is None:
            db.execute("INSERT INTO heard VALUES (?)", (now,))
        for n in found:
            if n["names"]:
                db.execute("UPDATE notams SET ended = 1 WHERE icao_id = ?", (n["names"],))
            if n["type"] == "C":
                # A cancellation is no NOTAM a pilot reads: it ends the one it names.
                continue
            # The other form of one NOTAM already kept keeps what it has
            # that this one lacks (its ICAO number, its domestic words).
            db.execute("""
                INSERT INTO notams (id, icao_id, location, icao_location, classification, issued, starts,
                                    ends, estimated, schedule, text, raw, ended, heard)
                VALUES (:id, :icao_id, :location, :icao_location, :classification, :issued, :starts,
                        :ends, :estimated, :schedule, :text, :raw, 0, :heard)
                ON CONFLICT (id) DO UPDATE SET
                    icao_id = COALESCE(excluded.icao_id, icao_id),
                    icao_location = COALESCE(excluded.icao_location, icao_location),
                    issued = excluded.issued, starts = excluded.starts, ends = excluded.ends,
                    estimated = excluded.estimated, schedule = excluded.schedule, text = excluded.text,
                    raw = CASE WHEN raw LIKE '!%' AND excluded.raw NOT LIKE '!%' THEN raw ELSE excluded.raw END,
                    heard = excluded.heard
            """, {**n, "estimated": int(n["estimated"]), "heard": now})
        db.execute("DELETE FROM notams WHERE (ends IS NOT NULL AND ends < ?) OR (ended = 1 AND heard < ?)",
                   (_stamp(now - KEEP_ENDED_S), now - KEEP_ENDED_S))
        db.commit()
    return len(found)


def since() -> float | None:
    """When the store first heard the feed, s; None before it has."""
    with _LOCK:
        row = _connection().execute("SELECT since FROM heard").fetchone()
    return row[0] if row else None


def _places(field: str) -> set[str]:
    """A field's identifiers as NOTAMs give them: the domestic location
    drops the K of a contiguous-states ICAO one (KBJC is BJC)."""
    field = field.strip().upper()
    places = {field}
    if len(field) == 4 and field.startswith("K"):
        places.add(field[1:])
    return places


def at_fields(fields: list[str], now: float | None = None) -> list[dict]:
    """The NOTAMs in force at these fields or yet to come, soonest first:
    not ended, cancelled or replaced. Each {"id", "location", "starts",
    "ends", "estimated", "schedule", "text", "raw"}."""
    now = time.time() if now is None else now
    places = sorted(set().union(*(_places(f) for f in fields))) if fields else []
    if not places:
        return []
    marks = ",".join("?" * len(places))
    with _LOCK:
        rows = _connection().execute(f"""
            SELECT id, location, starts, ends, estimated, schedule, text, raw FROM notams
            WHERE ended = 0 AND (ends IS NULL OR ends > ?)
              AND (location IN ({marks}) OR icao_location IN ({marks}))
            ORDER BY starts, id
        """, (_stamp(now), *places, *places)).fetchall()
    # One NOTAM sent in both forms, each in a message of its own, is two
    # numbers with nothing to tie them but their place, words and times:
    # given once, in the domestic form a briefing reads.
    found: dict[tuple, dict] = {}
    for r in rows:
        notam = {"id": r[0], "location": r[1], "starts": r[2], "ends": r[3], "estimated": bool(r[4]),
                 "schedule": r[5], "text": r[6], "raw": r[7]}
        same = (r[1], " ".join((r[6] or "").split()), r[2], r[3])
        if same not in found or (notam["raw"] or "").startswith("!"):
            found[same] = notam
    return list(found.values())
