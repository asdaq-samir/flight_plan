"""Which edition of each FAA data set the planner is using, and whether
it is still in force. Every one is published on a cycle and replaced at
the next -- NASR and the CIFP every 28 days (AIRAC), the charts and the
obstacle file every 56 -- and an old one reads as if nothing were wrong:
a frequency changed, an airspace redrawn, a procedure amended. With the
planner's own refresh off (production runs CHARTS_AUTO_REFRESH=0), only
this says so. The rule -- the cycles and their dates -- is the engine's
(`data_cycle`, native/crates/weather/src/cycles.rs, from the FAA's "28 and
56 Day Product Schedule" and its DOF page); this module only finds what
edition each file on disk is.

Warn, never limit (the owner, 2026-10-23): an edition past its cycle is
still used, and said to be out of date -- to the pilot on the Status page,
the map's settings and the Brief, to the owner in the log and the Dev
console's status.
"""
import json
import logging
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import wingtip_native

log = logging.getLogger(__name__)


def today() -> date:
    """The UTC day: the FAA's editions change on UTC dates."""
    return datetime.now(tz=timezone.utc).date()


def in_force_day() -> date:
    """The UTC day to choose an edition to use by: an edition takes effect
    at 0901Z on its date (the FAA's schedule; 14 CFR 91.103 wants current
    information), so before then the previous one is still the one in
    force. The engine counts from 0000Z, toward the safe side for a
    warning; choosing what to fetch and show must not run ahead of it."""
    return (datetime.now(tz=timezone.utc) - timedelta(hours=9, minutes=1)).date()


def cycle(kind: str, effective: date | None = None, on: date | None = None) -> dict:
    """The engine's `data_cycle`: the edition named `effective` of a data
    set on `kind`'s schedule ("airac", "chart" or "dof") held against `on`
    (today, UTC)."""
    asked = {"kind": kind, "effective": effective.isoformat() if effective else None, "on": (on or today()).isoformat()}
    return json.loads(wingtip_native.call("data_cycle", json.dumps(asked)))


def start_on(kind: str, on: date | None = None) -> date:
    """The day the edition in force on `on` (today) took effect."""
    return date.fromisoformat(cycle(kind, None, on)["current"])


def _day(text: str | None, pattern: str, fmt: str) -> date | None:
    match = re.search(pattern, text or "")
    if not match:
        return None
    try:
        return datetime.strptime(match.group(0), fmt).date()
    except ValueError:
        return None


def chart_effective(cycle_name: str | None) -> date | None:
    """A chart cycle's folder name ("10-29-2026") as its day."""
    return _day(cycle_name, r"\d{2}-\d{2}-\d{4}", "%m-%d-%Y")


def nasr_effective(text: str | None) -> date | None:
    """A NASR CSV's EFF_DATE ("2026/10/29") as its day."""
    return _day(text, r"\d{4}/\d{2}/\d{2}", "%Y/%m/%d")


def cifp_effective(name: str | None) -> date | None:
    """A CIFP cycle's name ("261029", its folder) as its day."""
    return _day(name, r"\d{6}", "%y%m%d")


def dof_effective(url: str | None) -> date | None:
    """The DOF's zip ("DOF_260927.zip", the last day of the changes it
    holds) as that day; the engine adds the two days to its release."""
    match = re.search(r"DOF_(\d{6})\.zip", url or "")
    return _day(match.group(1), r"\d{6}", "%y%m%d") if match else None


def entry(key: str, name: str, kind: str, effective: date | None, on: date | None = None) -> dict:
    """One data set's line: what it is, the edition held and the engine's
    answer for it."""
    answer = cycle(kind, effective, on)
    return {"key": key, "name": name, "kind": kind, "edition": effective.isoformat() if effective else None,
            "effective": answer["effective"], "expires": answer["expires"], "current": answer["current"],
            "state": answer["state"], "behind": answer["behind"]}


def _nasr_edition(cache_dir: Path) -> date | None:
    """The oldest of the NASR CSVs' own editions on disk: they come from
    separate zips (wingtip.faa_data's _EDITIONS), and one left behind is
    enough for the frequencies or the navaids to be wrong."""
    from .faa_data import _effective_date

    days = [nasr_effective(_effective_date(cache_dir / name))
            for name in ("APT_BASE.csv", "NAV_BASE.csv", "FIX_BASE.csv", "FRQ.csv") if (cache_dir / name).exists()]
    days = [d for d in days if d]
    return min(days) if days else None


def _dof_edition(cache_dir: Path) -> date | None:
    """The DOF on disk, by the link it came from (editions.json)."""
    try:
        return dof_effective(json.loads((cache_dir / "editions.json").read_text()).get("DOF"))
    except (OSError, ValueError, AttributeError):
        return None


def _cifp_edition() -> date | None:
    """The newest CIFP on disk: the one /api/procedures reads."""
    from .procedures import CIFP_DIR, CIFP_FILE

    held = sorted(p.parent.name for p in CIFP_DIR.glob(f"*/{CIFP_FILE}"))
    return cifp_effective(held[-1]) if held else None


def _charts_edition(charts) -> str | None:
    """The cycle the map draws, from disk or the held answer only
    (charts.serving_cycle can fetch, and this is polled): the newest
    complete sectional pyramid. None when there is none, as the cloud
    pointer is not read here: a row that would only say the FAA's current
    cycle is in force says nothing."""
    try:
        held = charts._serving_cache["value"]
        if charts.CHART_TILES_URL and held:
            return held
        return next((c for c in charts._cycles_on_disk(charts.CHART_TILE_CACHE_DIR)
                     if charts.pyramid_complete(c, ("sec",))), None)
    except Exception:  # noqa: BLE001 -- the status of the others is still worth having
        log.warning("chart cycle unknown", exc_info=True)
        return None


def status(on: date | None = None) -> list[dict]:
    """Each FAA data set the planner uses, with its edition and whether it
    is in force (today). Reads only what is on disk -- never the network --
    and a set with nothing on disk yet is left out: it is fetched when
    first asked for, the current one. The charts row needs a complete
    pyramid on disk. The d-TPP and the Chart Supplement
    are not here: they are fetched for the cycle in force on the day they
    are asked for (wingtip.publications), never kept past it."""
    from . import charts, pack
    from .terrain import DEFAULT_FAA_CACHE_DIR

    out = []
    for base in (DEFAULT_FAA_CACHE_DIR, DEFAULT_FAA_CACHE_DIR.parent):
        if (base / "APT_BASE.csv").exists():
            out.append(entry("nasr", "Airports, frequencies and navaids", "airac", _nasr_edition(base), on))
            break
    served = _charts_edition(charts)
    if served:
        out.append(entry("charts", "Charts", "chart", chart_effective(served), on))
    cifp = _cifp_edition()
    if cifp:
        out.append(entry("cifp", "Procedures", "airac", cifp, on))
    for base in (DEFAULT_FAA_CACHE_DIR, DEFAULT_FAA_CACHE_DIR.parent):
        if (base / "DOF.DAT").exists():
            out.append(entry("dof", "Obstacles", "dof", _dof_edition(base), on))
            break
    phone = pack.phone_index()
    if phone and phone.get("cycle"):
        try:
            held = date.fromisoformat(phone["cycle"])
        except ValueError:
            held = None
        out.append(entry("packs", "Offline packs", "airac", held, on))
    return out


_HELD: dict = {"at": 0.0, "entries": None}
#: How long `held` keeps its answer: the map's settings and the Status
#: page ask each minute, and an edition changes once in weeks.
HELD_S = 600


def held() -> list[dict]:
    """`status()` for today, kept HELD_S."""
    if _HELD["entries"] is None or time.time() - _HELD["at"] >= HELD_S:
        _HELD.update(entries=status(), at=time.time())
    return _HELD["entries"]


def out_of_date(entries: list[dict]) -> list[dict]:
    """The data sets past their cycle."""
    return [e for e in entries if e["state"] == "expired"]


_warned: dict = {"at": 0.0, "said": ""}
#: How often the same warning goes to the log again: once a day is enough
#: to be seen without filling the log.
WARN_EVERY_S = 24 * 3600


def warn_if_out_of_date(entries: list[dict] | None = None) -> list[dict]:
    """Log a warning for the owner when a data set is past its cycle --
    with the refresh off nothing else fetches a new one -- once a day, or
    at once when what is out of date changes. The data sets out of date."""
    stale = out_of_date(entries if entries is not None else status())
    said = "; ".join(f"{e['name']} ({e['edition']}, ended {e['expires']}, {e['behind']} behind)" for e in stale)
    if said and (said != _warned["said"] or time.time() - _warned["at"] >= WARN_EVERY_S):
        log.warning("FAA data past its cycle, still in use: %s", said)
        _warned.update(at=time.time(), said=said)
    elif not said:
        _warned.update(at=0.0, said="")
    return stale
