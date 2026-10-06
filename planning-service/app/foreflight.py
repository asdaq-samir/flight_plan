"""The route's checkpoints as a ForeFlight content pack
(https://foreflight.com/support/content-packs/): a ZIP of one folder that
ForeFlight downloads itself from its own link
(https://foreflight.com/content?downloadURL=...), or imports from Files.
It is built here, not in the browser, because that link needs an address
ForeFlight can fetch.

The address is short, and its last part the pack's file name:
``foreflight-pack/KORD-KDLH/KORD-KDLH-checkpoints.zip``. ForeFlight names
the download by the address, and would not install a pack from one that
carried the checkpoints themselves (about 2,000 characters): the same
file installed from a short address, and failed from a long one -- of
the same pack served both ways, only the long address failed. So the
route is all the address carries, and the checkpoints are the planner's
own selection for it (app.scoring), with no leg figures.

- ``navdata/``: each checkpoint a waypoint, usable in ForeFlight's route
  editor and on its map, with a page of its own beside it -- what it is,
  how easy it is to spot, where it is.
  ForeFlight ties a page to a waypoint by its file name: the waypoint's
  name, then the page's title.
- ``layers/``: the course line, and each checkpoint's name and score as a
  label on the map.

Waypoint names follow ForeFlight's rules: capitals, one word, at least
three characters with a letter (waypoint_names). The web app's .fpl
export (lib/flightPlanFiles) names the same points CP01 on, within
Garmin's six characters.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass
from html import escape

from vfr import places

from .scoring import KIND_NAMES

#: What to look for, by the chart's kind of thing.
LOOK_FOR = {
    "town": "A town: on the sectional, the yellow of its built-up area.",
    "water": "A lake: on the sectional, blue water.",
    "river": "A river: on the sectional, a blue line. Note where the course crosses it.",
    "road_or_rail": "A road or railway: on the sectional, a line across the course. Note the angle it crosses at.",
    "airport": "An airport: look for its runways.",
}

@dataclass(frozen=True)
class PackCheckpoint:
    lat: float
    lon: float
    #: The chart's kind: water, town, river, road_or_rail, airport.
    category: str
    #: How easy it is to spot, 0 to 5: the chart model's score.
    score: float
    #: Miles from the departure, along the whole route.
    along_nm: float
    #: The leg flown to it, where the nav log has worked one out.
    heading_deg: float | None = None
    altitude_ft: float | None = None
    minutes_flown: float | None = None

    @property
    def kind(self) -> str:
        """The chart's kind in words: "Town", "Lake"."""
        return KIND_NAMES.get(self.category, self.category)

    @property
    def name(self) -> str:
        """As the planner names it (app.scoring): the place where the place
        names know it, "Lake Zurich", else its kind."""
        return places.checkpoint_name(self.category, self.lat, self.lon) or self.kind


def from_candidates(selected: list[dict]) -> list[PackCheckpoint]:
    """The planner's selected checkpoints (app.scoring.route_checkpoints)
    as the pack takes them."""
    return [PackCheckpoint(lat=c["lat"], lon=c["lon"], category=c["category"], score=c["predicted_score"],
                           along_nm=c["along_track_nm"]) for c in selected]


def route_idents(route: str) -> list[str]:
    """The route in a pack's address, its idents dash-joined
    (KORD-KRYV-KDLH), as a list. A ValueError for fewer than two."""
    idents = [i for i in route.upper().split("-") if i]
    if len(idents) < 2 or not all(re.fullmatch(r"[A-Z0-9]{2,7}", i) for i in idents):
        raise ValueError(f"no route in {route!r}")
    return idents


def file_name(idents: list[str]) -> str:
    return f"{'-'.join(idents)}-checkpoints.zip"


def short(ident: str) -> str:
    """An identifier in a waypoint name: a US airport's K dropped, as a
    pilot says it (KDLH, DLH), and anything but letters and digits."""
    upper = re.sub(r"[^A-Z0-9]", "", ident.upper())
    return upper[1:] if len(upper) == 4 and upper.startswith("K") else upper


def waypoint_names(dep: str, dest: str, cps: list[PackCheckpoint]) -> list[str]:
    """Each checkpoint's waypoint name, in order, by ForeFlight's rules
    (capitals, one word, three characters with a letter): its place's name
    where it has one -- LAKE_ZURICH, RIVER_NEAR_SPRINGFIELD -- which is what
    ForeFlight then shows on its map and in a flight plan naming it; else
    the route's ends and its number, C81DLH03, as a bare "Lake" would be
    the same name in every pack. A name twice in one route gets _2."""
    width = max(2, len(str(len(cps))))
    names: list[str] = []
    for i, cp in enumerate(cps):
        place = re.sub(r"[^A-Z0-9]+", "_", cp.name.upper()).strip("_") if cp.name != cp.kind else ""
        name = place if len(place) >= 3 and re.search(r"[A-Z]", place) else f"{short(dep)}{short(dest)}{i + 1:0{width}d}"
        base, n = name, 2
        while name in names:
            name, n = f"{base}_{n}", n + 1
        names.append(name)
    return names


def description(cp: PackCheckpoint) -> str:
    """The line ForeFlight shows beside a waypoint, inside the 30 to 40
    characters it shows -- its kind, as the name is the place's: "Lake,
    3.2/5, 46 nm"."""
    return f"{cp.kind}, {cp.score:.1f}/5, {round(cp.along_nm)} nm"


def heading(deg: float) -> str:
    """001 to 360, as a pilot writes it."""
    whole = round(deg) % 360
    return f"{whole or 360:03d}°"


def degrees_minutes(lat: float, lon: float) -> str:
    """Degrees and decimal minutes, as a chart's margins write a
    position: "N42°19.0′ W088°05.4′"."""
    def part(value: float, positive: str, negative: str, width: int) -> str:
        whole = int(abs(value))
        minutes = (abs(value) - whole) * 60
        return f"{positive if value >= 0 else negative}{whole:0{width}d}°{minutes:04.1f}′"
    return f"{part(lat, 'N', 'S', 2)} {part(lon, 'E', 'W', 3)}"


def elapsed(minutes: float) -> str:
    total = round(minutes)
    return f"{total // 60}:{total % 60:02d}"


def _page(title: str, dep: str, dest: str, cps: list[PackCheckpoint], i: int) -> str:
    """A checkpoint's page: what it is, how easy it is to spot, the leg
    flown to it and where it is. HTML, in the .txt ForeFlight reads."""
    cp = cps[i]
    rows = [("How easy to spot", f"{cp.score:.1f} of 5"), (f"From {dep}", f"{cp.along_nm:.1f} nm")]
    if cp.heading_deg is not None:
        rows.append(("Magnetic heading to it", heading(cp.heading_deg)))
    if cp.altitude_ft is not None:
        rows.append(("Altitude", f"{round(cp.altitude_ft):,} ft"))
    if cp.minutes_flown is not None:
        rows.append(("Time from departure", elapsed(cp.minutes_flown)))
    rows.append(("Position", degrees_minutes(cp.lat, cp.lon)))
    nxt = cps[i + 1] if i + 1 < len(cps) else None
    return "\n".join([
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{escape(cp.name)}</title></head>",
        '<body style="font-family: -apple-system, sans-serif; font-size: 17px; line-height: 1.4; margin: 16px;">',
        f'<h2 style="margin: 0 0 4px;">{escape(cp.name)}</h2>',
        f'<p style="margin: 0 0 12px; color: #666;">Checkpoint {i + 1} of {len(cps)}, {escape(title)}</p>',
        f"<p>{escape(LOOK_FOR.get(cp.category, cp.name + '.'))}</p>",
        '<table style="border-collapse: collapse;">',
        *(f'<tr><td style="padding: 4px 16px 4px 0; color: #666;">{escape(k)}</td><td style="padding: 4px 0;">{escape(v)}</td></tr>'
          for k, v in rows),
        "</table>",
        f"<p>Next: {escape(nxt.name)}, {nxt.along_nm - cp.along_nm:.1f} nm on.</p>" if nxt
        else f"<p>The last checkpoint before {escape(dest)}.</p>",
        '<p style="color: #666; font-size: 15px;">How easy to spot is Wingtip Maps\' estimate, '
        "from a model trained on pilots' ratings of what the sectional shows.</p>",
        "</body></html>",
        "",
    ])


def _coordinates(lat: float, lon: float) -> str:
    return f"{lon:.6f},{lat:.6f},0"


def folder_name(idents: list[str]) -> str:
    """The pack's one folder: named as its file is, less the .zip, as
    ForeFlight's sample pack is (foreflight_sample_content_pack.zip holds
    foreflight_sample_content_pack/). A pack whose folder was named for
    Wingtip installed from Files but not from ForeFlight's own link."""
    return file_name(idents).removesuffix(".zip")


def pack_files(idents: list[str], line: list, cps: list[PackCheckpoint]) -> dict[str, str]:
    """Every file in the pack, by its path inside the ZIP. `idents` are
    the route's, departure first; `line` its course, (lat, lon) pairs.
    Nothing in it is the time it was made: ForeFlight asks for one address
    several times over, and each answer must be the same bytes."""
    dep, dest = idents[0], idents[-1]
    names = waypoint_names(dep, dest, cps)
    folder = folder_name(idents)
    title = " → ".join(idents)
    files = {
        f"{folder}/manifest.json": json.dumps({
            "name": f"Wingtip checkpoints {dep}-{dest}",
            "abbreviation": f"WT.{short(dep)}{short(dest)}",
            # ForeFlight shows it as a plain number (a date came out as
            # "20,261,006.032"); a pack made again goes over by its name.
            "version": 1,
            "organizationName": "Wingtip Maps",
        }, indent=2),
        f"{folder}/navdata/Checkpoints.kml": "\n".join([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<kml xmlns="http://www.opengis.net/kml/2.2">',
            "<Document>",
            f"<name>{escape(title)} checkpoints</name>",
            *(f"<Placemark><name>{name}</name><description>{escape(description(cp))}</description>"
              f"<Point><coordinates>{_coordinates(cp.lat, cp.lon)}</coordinates></Point></Placemark>"
              for name, cp in zip(names, cps)),
            "</Document>",
            "</kml>",
            "",
        ]),
        f"{folder}/layers/{short(dep)}-{short(dest)} course.kml": "\n".join([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<kml xmlns="http://www.opengis.net/kml/2.2">',
            "<Document>",
            f"<name>{escape(title)}</name>",
            # KML's colours run alpha, blue, green, red.
            '<Style id="course"><LineStyle><color>ffff8a1e</color><width>3</width></LineStyle></Style>',
            '<Style id="label"><IconStyle><scale>0</scale></IconStyle></Style>',
            f'<Placemark><name>{escape(title)}</name><styleUrl>#course</styleUrl><LineString><coordinates>'
            f'{" ".join(_coordinates(lat, lon) for lat, lon in line)}</coordinates></LineString></Placemark>',
            *(f"<Placemark><name>{escape(f'{cp.name} {cp.score:.1f}')}</name><styleUrl>#label</styleUrl>"
              f"<Point><coordinates>{_coordinates(cp.lat, cp.lon)}</coordinates></Point></Placemark>"
              for cp in cps),
            "</Document>",
            "</kml>",
            "",
        ]),
    }
    for i, (name, cp) in enumerate(zip(names, cps)):
        files[f"{folder}/navdata/{name}Checkpoint {i + 1} of {len(cps)}, {cp.name}.txt"] = _page(title, dep, dest, cps, i)
    return files


#: Every entry's time in the ZIP: one fixed time, so the same pack is the
#: same bytes (a ZIP otherwise stamps each entry with when it was written).
_ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def pack_zip(files: dict[str, str]) -> bytes:
    """The files zipped, each folder an entry of its own ahead of them, as
    ForeFlight's sample pack has."""
    folders = sorted({"/".join(path.split("/")[:i]) + "/" for path in files for i in range(1, path.count("/") + 1)})
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        for folder in folders:
            z.writestr(_entry(folder, _DIRECTORY), "")
        for path, text in files.items():
            z.writestr(_entry(path, _FILE), text, compress_type=zipfile.ZIP_DEFLATED)
    return buffer.getvalue()


#: Each entry's Unix mode, and for a folder the MS-DOS flag too. A ZipInfo
#: made by hand gets 0600 for a folder -- no way in -- and ForeFlight could
#: not install a pack whose folders came out that way.
_DIRECTORY = (0o40755 << 16) | 0x10
_FILE = 0o100644 << 16


def _entry(path: str, mode: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(path, _ZIP_TIME)
    info.external_attr = mode
    return info


def byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """The one byte range a Range header asks for, first and last byte
    inclusive -- as a download manager asks, ForeFlight's among them --
    or None for the whole file (no header, or one this does not serve:
    several ranges, another unit). A ValueError for a range past the end."""
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", (header or "").strip())
    if not match or match.group(1) == match.group(2) == "":
        return None
    first, last = match.groups()
    if first == "":
        start, end = max(0, size - int(last)), size - 1
    else:
        start, end = int(first), min(size - 1, int(last)) if last else size - 1
    if start > end or start >= size:
        raise ValueError(f"bytes {header} of {size}")
    return start, end
