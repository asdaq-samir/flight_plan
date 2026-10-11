"""A US airplane's FAA registration: who it is registered to, what it is,
its engine and its certificates, from the FAA's Releasable Aircraft
Database (registry.faa.gov/database/ReleasableAircraft.zip; its fields
and codes in the FAA's ardata.pdf, "Aircraft Registration Master File",
dated 5/8/2025). The FAA writes it each night; it is read again here
when the copy on disk is a day old, into a SQLite file beside the
download, so a lookup is one indexed read rather than the 195 MB master
file held in the planner's memory.

The FAA leaves out of it the names and addresses of owners who asked it
to withhold them (49 U.S.C. 44114(b)); of the rest, the owner's name and
town are given here, not the street.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import sqlite3
import tempfile
import threading
import time
import zipfile
from pathlib import Path

import requests

log = logging.getLogger(__name__)

URL = "https://registry.faa.gov/database/ReleasableAircraft.zip"
#: The registry's host (Akamai) turns a plain client away (403) and a
#: browser's agent alone too (503), and answers one with a browser's
#: Accept and Accept-Language as well (measured 2026-10-11).
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}
DEFAULT_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "faa_registry"
DB_NAME = "registry.sqlite"
#: The copy on disk is read again once it is this old, s: the FAA's is
#: written each night.
MAX_AGE_S = 24 * 3600

# The FAA's codes (ardata.pdf), in words.
_REGISTRANT = {"1": "Individual", "2": "Partnership", "3": "Corporation", "4": "Co-owned", "5": "Government",
               "7": "LLC", "8": "Non-citizen corporation", "9": "Non-citizen co-owned"}
_AIRCRAFT = {"1": "Glider", "2": "Balloon", "3": "Blimp or dirigible", "4": "Fixed wing single engine",
             "5": "Fixed wing multi engine", "6": "Rotorcraft", "7": "Weight-shift-control", "8": "Powered parachute",
             "9": "Gyroplane", "H": "Hybrid lift", "O": "Other"}
_ENGINE = {"0": "None", "1": "Reciprocating", "2": "Turbo-prop", "3": "Turbo-shaft", "4": "Turbo-jet", "5": "Turbo-fan",
           "6": "Ramjet", "7": "2 cycle", "8": "4 cycle", "9": "Unknown", "10": "Electric", "11": "Rotary"}
#: The airworthiness certificate's class (the certification field's first
#: position), and for the commonest the operation it is approved for.
_CLASS = {"1": "Standard", "2": "Limited", "3": "Restricted", "4": "Experimental", "5": "Provisional",
          "6": "Multiple", "7": "Primary", "8": "Special flight permit", "9": "Light sport"}
_STANDARD = {"N": "normal", "U": "utility", "A": "acrobatic", "T": "transport", "G": "glider", "B": "balloon",
             "C": "commuter", "O": "other"}
_EXPERIMENTAL = {"0": "to show compliance with the FARs", "1": "research and development", "2": "amateur built",
                 "3": "exhibition", "4": "racing", "5": "crew training", "6": "market survey",
                 "7": "operating kit built aircraft", "8A": "registered before 01/31/08",
                 "8B": "operating light-sport kit-built", "8C": "operating light-sport previously certificated under 21.190"}
_LIGHT_SPORT = {"A": "airplane", "G": "glider", "L": "lighter than air", "P": "powered parachute", "W": "weight-shift-control"}
#: The registration's status (ardata.pdf, Status Code), in the FAA's words.
_STATUS = {
    "A": "Triennial registration form mailed, not returned", "D": "Expired dealer",
    "E": "Certificate of registration revoked by enforcement action",
    "M": "Valid: assigned to the manufacturer under its dealer certificate",
    "N": "Non-citizen corporation that has not returned its flight hour reports", "R": "Registration pending",
    "S": "Second triennial registration form mailed, not returned", "T": "Valid: a trainee's registration",
    "V": "Valid", "W": "Certificate of registration deemed ineffective or invalid", "X": "Enforcement letter",
    "Z": "Permanently reserved", "1": "Triennial registration form returned as undeliverable",
    "2": "N-number assigned, not yet registered", "3": "N-number assigned to a non-type-certificated aircraft, not yet registered",
    "4": "N-number assigned to an import, not yet registered", "5": "Reserved N-number", "6": "Administratively canceled",
    "7": "Sale reported", "8": "Second triennial registration form mailed, no response", "9": "Certificate of registration revoked",
    "10": "N-number assigned, not registered, pending cancellation",
    "11": "N-number assigned to a non-type-certificated (amateur) aircraft, not registered, pending cancellation",
    "12": "N-number assigned to an import, not registered, pending cancellation", "13": "Registration expired",
    "14": "First notice for re-registration or renewal", "15": "Second notice for re-registration or renewal",
    "16": "Registration expired, pending cancellation", "17": "Sale reported, pending cancellation",
    "18": "Sale reported, canceled", "19": "Registration pending, pending cancellation", "20": "Registration pending, canceled",
    "21": "Revoked, pending cancellation", "22": "Revoked, canceled", "23": "Expired dealer, pending cancellation",
    "24": "Third notice for re-registration or renewal", "25": "First notice for registration renewal",
    "26": "Second notice for registration renewal", "27": "Registration expired", "28": "Third notice for registration renewal",
    "29": "Registration expired, pending cancellation",
}
#: The codes the FAA calls valid, and those of a registration not in
#: effect -- expired, revoked, canceled, ineffective, or an N-number never
#: registered; the rest (a form not returned, a sale reported, a renewal
#: notice) are said as they are.
_VALID = frozenset("VMT")
_LAPSED = frozenset({"D", "E", "W", "Z", "2", "3", "4", "5", "6", "9", "10", "11", "12", "13", "16", "18", "20", "21",
                     "22", "23", "27", "29"})

_LOCK = threading.Lock()
_BUILDING = threading.Event()


#: Words of a name kept in capitals: a company's form.
_KEPT = frozenset({"LLC", "LLP", "LP", "PC", "PLLC", "USA", "US", "II", "III", "IV", "FBO", "DBA"})
#: Words of three letters or fewer in a maker's name written as words,
#: not as its initials.
_WORDS = frozenset({"INC", "CO", "LTD", "AND", "THE", "OF", "DE", "LA", "Y", "DEL", "EL", "VAN", "VON"})


def _name_case(text: str, maker: bool = False) -> str:
    """A name in the FAA's capitals as a name is written: "ROCA ROJA Y
    CABALLO GRIS DE IDAHO LLC" as "Roca Roja Y Caballo Gris De Idaho LLC",
    "UNITED AIRLINES INC" as "United Airlines Inc"; a company's form and a
    word with figures kept, and in a maker's name (`maker`) its initials
    too ("IAE", "CFM"), which in a person's ("JOE") are a name."""
    def word(w: str) -> str:
        bare = w.strip(".,&")
        if bare in _KEPT or any(c.isdigit() for c in w) or (maker and len(bare) <= 3 and bare.isalpha() and bare not in _WORDS):
            return w
        return w.capitalize()
    return " ".join(word(w) for w in text.split())


def _date(text: str) -> str | None:
    """The FAA's YYYYMMDD as an ISO date."""
    text = text.strip()
    return f"{text[:4]}-{text[4:6]}-{text[6:8]}" if re.fullmatch(r"\d{8}", text) else None


def _number(text: str) -> int | None:
    text = text.strip()
    return int(text) if text.isdigit() else None


def _airworthiness(code: str) -> str | None:
    """The certification field in words: "1NU" as "Standard (normal,
    utility)", "42" as "Experimental (amateur built)"."""
    code = code.strip()
    if not code or code[0] not in _CLASS:
        return None
    kind, rest = _CLASS[code[0]], code[1:]
    if code[0] == "1":
        uses = [_STANDARD[c] for c in rest if c in _STANDARD]
    elif code[0] == "4":
        uses = [_EXPERIMENTAL[u] for u in re.findall(r"8[ABC]|9[A-E]|[0-7]", rest) if u in _EXPERIMENTAL]
    elif code[0] == "9":
        uses = [_LIGHT_SPORT[c] for c in rest[:1] if c in _LIGHT_SPORT]
    else:
        uses = []
    return f"{kind} ({', '.join(uses)})" if uses else kind


def _rows(archive: zipfile.ZipFile, name: str):
    """A file of the archive as rows of stripped fields by its header's
    names (the FAA's files carry a byte-order mark and a trailing comma)."""
    with archive.open(name) as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace"))
        header = [h.strip() for h in next(reader)]
        for row in reader:
            yield dict(zip(header, (cell.strip() for cell in row)))


def build(zip_path: Path, db_path: Path) -> int:
    """The registry's SQLite file from the FAA's archive, written beside
    and then put in place whole; how many airplanes it holds."""
    with zipfile.ZipFile(zip_path) as archive:
        # What is used of the reference files, as tuples: ACFTREF's ninety
        # thousand models as dicts were a hundred megabytes of the planner's.
        models = {r["CODE"]: (r["MFR"], r["MODEL"], r["NO-ENG"], r["NO-SEATS"]) for r in _rows(archive, "ACFTREF.txt")}
        engines = {r["CODE"]: (r["MFR"], r["MODEL"], r["HORSEPOWER"], r["THRUST"]) for r in _rows(archive, "ENGINE.txt")}
        fd, tmp = tempfile.mkstemp(dir=db_path.parent, prefix=".registry-", suffix=".sqlite")
        os.close(fd)
        try:
            db = sqlite3.connect(tmp)
            db.execute("""CREATE TABLE aircraft (n_number TEXT PRIMARY KEY, mode_s_hex TEXT, serial TEXT, manufacturer TEXT,
                model TEXT, year INTEGER, aircraft_type TEXT, engines INTEGER, seats INTEGER, engine TEXT, engine_type TEXT,
                horsepower INTEGER, thrust_lb INTEGER, owner TEXT, owner_type TEXT, co_owners INTEGER, city TEXT, state TEXT,
                country TEXT, status_code TEXT, certificate_issued TEXT, expires TEXT, airworthiness TEXT,
                airworthiness_date TEXT, kit TEXT, fractional INTEGER)""")
            count = 0
            batch = []
            for r in _rows(archive, "MASTER.txt"):
                n = r.get("N-NUMBER", "")
                if not n:
                    continue
                maker, model, engine_count, seats = models.get(r.get("MFR MDL CODE", ""), ("", "", "", ""))
                engine_maker, engine_model, horsepower, thrust = engines.get(r.get("ENG MFR MDL", ""), ("", "", "", ""))
                kit = " ".join(p for p in (r.get("KIT MFR", ""), r.get("KIT MODEL", "")) if p)
                engine_name = " ".join(p for p in (engine_maker, engine_model) if p and p != "NONE")
                batch.append((
                    "N" + n, (r.get("MODE S CODE HEX") or "").lower() or None, r.get("SERIAL NUMBER") or None,
                    _name_case(maker, maker=True) if maker else None, model or None,
                    _number(r.get("YEAR MFR", "")), _AIRCRAFT.get(r.get("TYPE AIRCRAFT", "")),
                    _number(engine_count), _number(seats),
                    _name_case(engine_name, maker=True) if engine_name else None, _ENGINE.get(r.get("TYPE ENGINE", "")),
                    _number(horsepower) or None, _number(thrust) or None,
                    _name_case(r["NAME"]) if r.get("NAME") else None, _REGISTRANT.get(r.get("TYPE REGISTRANT", "")),
                    sum(1 for i in range(1, 6) if r.get(f"OTHER NAMES({i})")),
                    _name_case(r["CITY"]) if r.get("CITY") else None, r.get("STATE") or None, r.get("COUNTRY") or None,
                    r.get("STATUS CODE") or None, _date(r.get("CERT ISSUE DATE", "")), _date(r.get("EXPIRATION DATE", "")),
                    _airworthiness(r.get("CERTIFICATION", "")), _date(r.get("AIR WORTH DATE", "")),
                    _name_case(kit, maker=True) if kit else None, 1 if r.get("FRACT OWNER") == "Y" else 0,
                ))
                if len(batch) >= 5000:
                    db.executemany(f"INSERT OR REPLACE INTO aircraft VALUES ({','.join('?' * 26)})", batch)
                    count += len(batch)
                    batch = []
            db.executemany(f"INSERT OR REPLACE INTO aircraft VALUES ({','.join('?' * 26)})", batch)
            count += len(batch)
            db.execute("CREATE INDEX aircraft_mode_s ON aircraft (mode_s_hex)")
            db.commit()
            db.close()
            os.replace(tmp, db_path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return count


def refresh(directory: Path = DEFAULT_DIR, force: bool = False) -> bool:
    """The FAA's registry downloaded and read again where the copy on disk
    is a day old or missing; whether it was. One at a time: a second
    caller while one reads it returns at once."""
    directory = Path(directory)
    db_path = directory / DB_NAME
    if not force and db_path.exists() and time.time() - db_path.stat().st_mtime < MAX_AGE_S:
        return False
    with _LOCK:
        if _BUILDING.is_set():
            return False
        _BUILDING.set()
    try:
        directory.mkdir(parents=True, exist_ok=True)
        zip_path = directory / "ReleasableAircraft.zip"
        resp = requests.get(URL, headers=HEADERS, timeout=300, stream=True)
        resp.raise_for_status()
        with open(zip_path, "wb") as out:
            for chunk in resp.iter_content(1 << 20):
                out.write(chunk)
        count = build(zip_path, db_path)
        zip_path.unlink(missing_ok=True)
        log.info("FAA aircraft registry read: %d airplanes", count)
        return True
    finally:
        _BUILDING.clear()


def lookup(hex_id: str | None = None, n_number: str | None = None, directory: Path = DEFAULT_DIR) -> dict | None:
    """An airplane's registration by its transponder's ICAO address or its
    N-number; None where the registry is not read yet or has no such
    airplane (one registered abroad among them). "status" is the FAA's
    status in words, "standing" whether it is valid, not in effect
    ("lapsed") or something between ("other": a form not returned, a
    sale reported, a renewal notice)."""
    db_path = Path(directory) / DB_NAME
    if not db_path.exists():
        return None
    n = (n_number or "").strip().upper().replace("-", "")
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        row = None
        if hex_id:
            row = db.execute("SELECT * FROM aircraft WHERE mode_s_hex = ?", (hex_id.lower().lstrip("~"),)).fetchone()
        if row is None and re.fullmatch(r"N[1-9][0-9A-Z]{0,4}", n):
            row = db.execute("SELECT * FROM aircraft WHERE n_number = ?", (n,)).fetchone()
    if row is None:
        return None
    found = dict(row)
    code = found.pop("status_code") or ""
    found["standing"] = "valid" if code in _VALID else "lapsed" if code in _LAPSED else "other"
    found["status"] = _STATUS.get(code) or (f"FAA status {code}" if code else None)
    found["fractional"] = bool(found["fractional"])
    return found
