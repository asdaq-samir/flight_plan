"""The tracks recorded here, a file an airplane, and the airplanes followed: those whose card
has been opened, whose flights are recorded from any source, card open or not."""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..config import get_settings
from .common import _LOCK, _wall

#: A recorded track is kept this long, s: the archive's own reach
#: (ARCHIVE_DAYS), its flights listed with the archive's.
RECORD_KEEP_S = 30 * 86400.0
#: Where each airplane's recorded track is kept, a file each, so a restart
#: of the planner does not lose the flights it watched.
RECORDED_DIR = get_settings().recorded_tracks_dir

_RECORDED: dict[str, list[dict]] = {}


# An airplane's ICAO address, six hex digits (a TIS-B one's "~" taken off):
# all its track's file is named by. The addresses come from the feeds and
# from requests; one that is not this names no file, so none can reach out
# of the directory (CodeQL's py/path-injection).
_ICAO_HEX = re.compile(r"[0-9a-fA-F]{6}")


def _recorded_file(hex_id: str) -> Path | None:
    key = hex_id.lstrip("~")
    return RECORDED_DIR / f"{key}.json" if _ICAO_HEX.fullmatch(key) else None


def _load_recorded(hex_id: str) -> None:
    """An airplane's recorded track read from its file the first time it is
    wanted; nothing where there is none or it cannot be read. Called with
    the lock held. An address that names no file is not kept at all, so
    junk ids from requests cannot grow the map; readers take a missing key
    as an empty track."""
    if hex_id in _RECORDED:
        return
    path = _recorded_file(hex_id)
    if path is None:
        return
    try:
        kept = json.loads(path.read_text())
        _RECORDED[hex_id] = [p for p in kept if isinstance(p, dict) and "t" in p] if isinstance(kept, list) else []
    except (OSError, ValueError):
        _RECORDED[hex_id] = []


def _save_recorded(hex_id: str, track: list[dict]) -> None:
    """The track written to its file whole, through a file beside it, so a
    read never finds half of one; a failure to write leaves the old one."""
    path = _recorded_file(hex_id)
    if path is None:
        return
    try:
        RECORDED_DIR.mkdir(parents=True, exist_ok=True)
        part = path.with_suffix(".part")
        part.write_text(json.dumps(track))
        part.replace(path)
    except OSError:
        pass


#: Airplanes followed: those whose card has been opened, kept as long as
#: their recorded track (RECORDED_DIR's files), whose flights are recorded
#: from any source, card open or not.
_FOLLOWED: set[str] = set()
_FOLLOWED_READ = {"done": False}


def _followed(hex_id: str) -> bool:
    with _LOCK:
        if not _FOLLOWED_READ["done"]:
            _FOLLOWED_READ["done"] = True
            try:
                _FOLLOWED.update(p.stem for p in RECORDED_DIR.glob("*.json"))
            except OSError:
                pass
        return hex_id in _FOLLOWED


def follow(hex_id: str) -> None:
    """An airplane followed from now on: its card opened. Kept across a
    restart of the planner by its track's file, written now, empty, where
    it has none yet: the owner's N3429J, its card opened before a restart
    and nothing heard of it since, was followed no more."""
    hex_id = hex_id.lstrip("~")
    _followed(hex_id)
    with _LOCK:
        new = hex_id not in _FOLLOWED
        _FOLLOWED.add(hex_id)
        if new:
            _load_recorded(hex_id)
            kept = list(_RECORDED.get(hex_id, []))
    if new and not kept:
        _save_recorded(hex_id, kept)


def _record(hex_id: str, plane: dict) -> None:
    """A watched airplane's report kept as a trace point is (`_points`), its
    time when it was heard, not when it was asked."""
    at = round(_wall() - (plane.get("seen_s") or 0.0), 1)
    point = {
        "t": at, "lat": plane["lat"], "lon": plane["lon"], "alt_ft": plane.get("altitude_ft"),
        "gs_kt": plane.get("speed_kt"), "track_deg": plane.get("track_deg"), "vrate_fpm": plane.get("vertical_fpm"),
        "new_leg": False, "plane": plane,
    }
    with _LOCK:
        _load_recorded(hex_id)
        if hex_id not in _RECORDED:
            return
        track = _RECORDED[hex_id]
        if track and track[-1]["t"] >= at:
            return
        track.append(point)
        while track and at - track[0]["t"] > RECORD_KEEP_S:
            track.pop(0)
        kept = list(track)
    _save_recorded(hex_id, kept)


def _recorded(hex_id: str) -> list[dict]:
    with _LOCK:
        _load_recorded(hex_id)
        return list(_RECORDED.get(hex_id, []))
