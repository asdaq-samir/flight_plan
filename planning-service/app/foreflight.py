"""The route's checkpoints as a ForeFlight content pack
(https://foreflight.com/support/content-packs/): a ZIP of one folder that
ForeFlight downloads itself from an "Open in ForeFlight" link
(https://foreflight.com/content?downloadURL=...), or imports from Files.
It is built here, not in the browser, because that link needs an address
ForeFlight can fetch -- one that ends in the pack's file name: ForeFlight
names a download by the end of its address, query and all, and a pack
asked for as ``foreflight-pack?dep=...`` came in under that name and was
refused. So the route and its checkpoints ride in the path, as one token
(``token``), ahead of the file name.

- ``navdata/``: each checkpoint a waypoint, usable in ForeFlight's route
  editor and on its map, with a page of its own beside it -- what it is,
  how easy it is to spot, the leg flown to it. ForeFlight ties a page to
  a waypoint by its file name: the waypoint's name, then the page's title.
- ``layers/``: the course line, and each checkpoint's kind and score as a
  label on the map.

Waypoint names follow ForeFlight's rules: capitals, one word, at least
three characters with a letter. Each is the route's ends and its number
-- C81DLH01 -- so the packs of two routes never share a name. The web
app's .fpl export (lib/flightPlanFiles) names the same points CP01 on,
within Garmin's six characters.
"""
from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from urllib.parse import parse_qs, urlencode
from dataclasses import dataclass
from datetime import datetime
from html import escape

from .scoring import KIND_NAMES

#: What to look for, by the chart's kind of thing.
LOOK_FOR = {
    "town": "A town: on the sectional, the yellow of its built-up area.",
    "water": "A lake: on the sectional, blue water.",
    "river": "A river: on the sectional, a blue line. Note where the course crosses it.",
    "road_or_rail": "A road or railway: on the sectional, a line across the course. Note the angle it crosses at.",
    "airport": "An airport: look for its runways.",
}

#: The most checkpoints a pack takes: far more than any route selects.
MAX_CHECKPOINTS = 200


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
    def name(self) -> str:
        return KIND_NAMES.get(self.category, self.category)


def parse_checkpoints(text: str) -> list[PackCheckpoint]:
    """The checkpoints as the web app writes them into the pack's address:
    ``lat,lon,kind,score,along[,heading,altitude,minutes]``, each one
    ``~``-separated, a leg's figure left empty where the nav log has none.
    A ValueError says what is wrong."""
    out = []
    for i, entry in enumerate(filter(None, text.split("~"))):
        fields = entry.split(",")
        if not 5 <= len(fields) <= 8:
            raise ValueError(f"checkpoint {i + 1}: {len(fields)} fields, not 5 to 8")
        lat, lon, category, score, along, *leg = fields
        number = lambda v: float(v) if v != "" else None  # noqa: E731
        cp = PackCheckpoint(
            lat=float(lat), lon=float(lon), category=category, score=float(score), along_nm=float(along),
            heading_deg=number(leg[0]) if len(leg) > 0 else None,
            altitude_ft=number(leg[1]) if len(leg) > 1 else None,
            minutes_flown=number(leg[2]) if len(leg) > 2 else None,
        )
        if not (-90 <= cp.lat <= 90 and -180 <= cp.lon <= 180):
            raise ValueError(f"checkpoint {i + 1}: no such position")
        if cp.category not in KIND_NAMES:
            raise ValueError(f"checkpoint {i + 1}: no such kind {cp.category!r}")
        out.append(cp)
    if len(out) > MAX_CHECKPOINTS:
        raise ValueError(f"{len(out)} checkpoints, more than {MAX_CHECKPOINTS}")
    return out


def token(dep: str, dest: str, stops: str, cp: str) -> str:
    """The route and its checkpoints as one path segment: the query they
    would make, base64url without its padding (the web app's packPath
    writes the same)."""
    query = urlencode({"dep": dep, "dest": dest, "stops": stops, "cp": cp})
    return base64.urlsafe_b64encode(query.encode()).decode().rstrip("=")


def read_token(text: str) -> dict[str, str]:
    """`token` read back: dep, dest, stops and cp. A ValueError for one
    that is not a token, or names no route."""
    try:
        query = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)).decode()
    except (ValueError, UnicodeDecodeError):
        raise ValueError("not a pack's address") from None
    fields = {k: v[0] for k, v in parse_qs(query, keep_blank_values=True).items()}
    if not fields.get("dep") or not fields.get("dest"):
        raise ValueError("no route in the pack's address")
    return {"dep": fields["dep"], "dest": fields["dest"], "stops": fields.get("stops", ""), "cp": fields.get("cp", "")}


def file_name(idents: list[str]) -> str:
    return f"{'-'.join(idents)}-checkpoints.zip"


def short(ident: str) -> str:
    """An identifier in a waypoint name: a US airport's K dropped, as a
    pilot says it (KDLH, DLH), and anything but letters and digits."""
    upper = re.sub(r"[^A-Z0-9]", "", ident.upper())
    return upper[1:] if len(upper) == 4 and upper.startswith("K") else upper


def waypoint_names(dep: str, dest: str, count: int) -> list[str]:
    """Each checkpoint's waypoint name, in order: C81DLH01, C81DLH02..."""
    width = max(2, len(str(count)))
    return [f"{short(dep)}{short(dest)}{i + 1:0{width}d}" for i in range(count)]


def description(cp: PackCheckpoint) -> str:
    """The line ForeFlight shows beside a waypoint, inside the 30 to 40
    characters it shows: "Lake, 3.2/5, 46 nm"."""
    return f"{cp.name}, {cp.score:.1f}/5, {round(cp.along_nm)} nm"


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


def folder_name(dep: str, dest: str) -> str:
    return f"Wingtip-{short(dep)}-{short(dest)}"


def pack_files(idents: list[str], line: list, cps: list[PackCheckpoint], created: datetime) -> dict[str, str]:
    """Every file in the pack, by its path inside the ZIP. `idents` are
    the route's, departure first; `line` its course, (lat, lon) pairs."""
    dep, dest = idents[0], idents[-1]
    names = waypoint_names(dep, dest, len(cps))
    folder = folder_name(dep, dest)
    title = " → ".join(idents)
    files = {
        f"{folder}/manifest.json": json.dumps({
            "name": f"Wingtip checkpoints {dep}-{dest}",
            "abbreviation": f"WT.{short(dep)}{short(dest)}",
            # ForeFlight shows it as a plain number (a date came out as
            # "20,261,006.032"); a pack made again goes over by its name.
            "version": 1,
            "effectiveDate": created.strftime("%Y%m%dT%H:%M:%SZ"),
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


def pack_zip(files: dict[str, str]) -> bytes:
    """The files zipped, each folder an entry of its own ahead of them, as
    ForeFlight's sample pack has."""
    folders = sorted({"/".join(path.split("/")[:i]) + "/" for path in files for i in range(1, path.count("/") + 1)})
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        for folder in folders:
            z.writestr(folder, "")
        for path, text in files.items():
            z.writestr(path, text)
    return buffer.getvalue()
