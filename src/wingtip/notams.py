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

import json
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone

import wingtip_native

from .config import get_settings

STORE = get_settings().notam_store
#: How long an ended NOTAM is kept, s: a day, for a briefing read just after.
KEEP_ENDED_S = 24 * 3600

#: The ICAO location prefixes of the United States and its territories
#: (ICAO Doc 7910): the contiguous states K, Alaska PA-PP, Hawaii PH,
#: the Pacific islands PG/PK/PW..., Puerto Rico TJ, the Virgin Islands TI
#: and American Samoa NS (NSTU).
US_PREFIXES = ("K", "P", "TJ", "TI", "NS")
#: The ICAO form's place, its item A) ("A) KBJC"), and the domestic form's
#: location and number ("!BJC 10/060", a military one's "!KEDG M0061/26"):
#: what a store of the earlier layout is kept by again (_upgrade). A
#: message's NOTAMs are read by the engine (notam.rs), by the same patterns.
_ICAO_PLACE = re.compile(r"\bA\)\s*([A-Z]{4})\b")
_DOMESTIC_ID = re.compile(r"^!(\w+)\s+([A-Z]?\d{1,4}/\d{1,4})")
#: The store's layout: 1 since a NOTAM known only by its ICAO number is
#: kept by its place and number, not the number alone (_upgrade).
STORE_VERSION = 1

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
        _upgrade(_db)
    return _db


def _upgrade(db: sqlite3.Connection) -> None:
    """A store kept by an earlier layout, put in this one.

    Before version 1 a NOTAM with no domestic form, or a military one
    ("!KEDG M0061/26", whose number the domestic pattern did not take), was
    kept by its ICAO number alone. Those numbers are each issuer's own: a
    base's M series, a country's A series, so KEDG's M0061/26 was written
    over KAPG's, a row with one's place and the other's words (15 of the
    4,011 kept so on 2026-11-02). Each is kept again by its place and
    number, its place read from its own words where they give one; the
    NOTAM it was written over is gone until the feed sends it again."""
    if db.execute("PRAGMA user_version").fetchone()[0] >= STORE_VERSION:
        return
    rows = db.execute("SELECT id, location, icao_location, raw FROM notams WHERE id NOT LIKE '% %'").fetchall()
    for old, location, icao_location, raw in rows:
        domestic = _DOMESTIC_ID.match(raw or "")
        place = _ICAO_PLACE.search(raw or "")
        if domestic:
            key, fix = f"{domestic.group(1)} {domestic.group(2)}", {"icao_location": domestic.group(1)}
            # Its location is the word after the number, as the domestic form writes it.
            words = (raw or "").split()
            if len(words) > 2:
                fix["location"] = words[2]
        elif place:
            key, fix = f"{place.group(1)} {old}", {"icao_location": place.group(1)}
        else:
            key, fix = f"{icao_location or location} {old}", {}
        db.execute("DELETE FROM notams WHERE id = ? AND EXISTS (SELECT 1 FROM notams WHERE id = ?)", (old, key))
        db.execute("UPDATE notams SET id = ?, location = COALESCE(?, location), icao_location = COALESCE(?, icao_location)"
                   " WHERE id = ?", (key, fix.get("location"), fix.get("icao_location"), old))
    db.execute(f"PRAGMA user_version = {STORE_VERSION}")
    db.commit()


def reset() -> None:
    """The connection closed, for a test to point STORE at its own file."""
    global _db
    with _LOCK:
        if _db is not None:
            _db.close()
        _db = None


def _stamp(now: float) -> str:
    """A moment as the store's times are written, to compare with them."""
    return datetime.fromtimestamp(int(now), timezone.utc).isoformat().replace("+00:00", "Z")


def notams(xml: str) -> list[dict]:
    """The NOTAMs of one FNS message, each {"id", "icao_id", "names",
    "type", "location", "icao_location", "classification", "issued",
    "starts", "ends", "estimated", "schedule", "text", "raw"}: `names` is
    the NOTAM a NOTAMR or NOTAMC ends. `ends` is the sooner of its own end
    and its feature lifetime's, for one cancelled early. Each is kept by
    its domestic place and number, else its place and ICAO number. Read by
    the engine (notam.rs, `notams_fns`), as a phone reads one; none where
    the message is not XML."""
    return json.loads(wingtip_native.call("notams_fns", json.dumps({"text": xml})))


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
                # The one it names at its own place: another place's NOTAM
                # may have the same number.
                db.execute("UPDATE notams SET ended = 1 WHERE icao_id = ? AND (location = ? OR icao_location = ?)",
                           (n["names"], n["location"], n["icao_location"]))
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
