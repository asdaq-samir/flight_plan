"""Where and when the flight meets each hazard the briefing tells of: the
legs it is on (the nav log's, fix to fix, where the page sent them;
else the route's own, airport to airport), how far along, the times
the airplane gets there and leaves, and whether that is while the
hazard is valid. The briefing used to list what was near the route at
any time during the flight, and the page worked out on its own when
the airplane passed a TFR; this says it for every hazard, once.

The times are the departure plus the legs' minutes, a leg's minutes
shared out along it by distance, and each stop's minutes on the ground
after its leg. A climb is slower than the cruise, so a point early on
the first leg is reached a little later than this says; the window a
hazard is compared with is widened by PASS_MARGIN_MIN either way for
that, which can say "during" when it is not, never the other way."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from itertools import pairwise

import shapely
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import nearest_points
from vfr import geo

from .gonogo.pass_times import PASS_MARGIN_MIN, instant

#: A G-AIRMET is "issued at discrete times 3 hours apart" and is "only
#: valid at specific time snapshots", the nearest of which a user is
#: shown (aviationweather.gov, Graphical Forecasts for Aviation help):
#: so a snapshot stands for the hour and a half either side of it.
GAIRMET_HALF_INTERVAL = timedelta(minutes=90)


def iso(t: float | None) -> str | None:
    """UNIX seconds as ISO 8601 UTC with its Z, to the second."""
    if t is None:
        return None
    return datetime.fromtimestamp(round(t), timezone.utc).isoformat().replace("+00:00", "Z")


def _unix(text: str | None) -> float | None:
    if not text:
        return None
    try:
        return instant(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


@dataclass(frozen=True)
class Legs:
    """The legs a briefing's hazards are placed on: `fixes` [(lat, lon)],
    one more than the legs; each leg's length (nm), the time it is left
    (UNIX seconds) and its minutes in the air."""

    fixes: list[tuple[float, float]]
    nm: list[float]
    starts: list[float]
    minutes: list[float]
    from_navlog: bool

    @classmethod
    def of(cls, fixes: list[tuple[float, float]], depart_s: float, ete_s: float,
           leg_min: list[float] | None = None, ground_min: list[float] | None = None) -> Legs:
        """The legs between `fixes` from `depart_s`: each flown in its own
        `leg_min` (the nav log's ETEs) and followed by its `ground_min` on
        the ground, where they are one a leg; else the whole flight's
        `ete_s` shared out by distance (the route as entered, before the
        nav log is in)."""
        nm = [geo.distance_nm(*a, *b) for a, b in pairwise(fixes)]
        navlog = leg_min is not None and len(leg_min) == len(nm)
        if navlog:
            minutes = list(leg_min)
        else:
            total = sum(nm)
            minutes = [ete_s / 60 * (d / total) if total else ete_s / 60 / max(1, len(nm)) for d in nm]
        ground = ground_min if navlog and ground_min is not None and len(ground_min) == len(nm) else [0.0] * len(nm)
        starts, t = [], depart_s
        for m, g in zip(minutes, ground):
            starts.append(t)
            t += (m + g) * 60
        return cls(fixes=list(fixes), nm=nm, starts=starts, minutes=minutes, from_navlog=navlog)

    @property
    def total_nm(self) -> float:
        return sum(self.nm)

    def leg_at(self, along_nm: float) -> int:
        """The leg `along_nm` is on: at a fix, the leg arriving there."""
        offset = 0.0
        for i, d in enumerate(self.nm):
            if along_nm <= offset + d:
                return i
            offset += d
        return max(0, len(self.nm) - 1)

    def time_at(self, along_nm: float) -> float:
        """When the airplane is `along_nm` from the departure (UNIX
        seconds): the leg it is on, taken pro rata."""
        i = self.leg_at(along_nm)
        offset = sum(self.nm[:i])
        share = min(1.0, max(0.0, (along_nm - offset) / self.nm[i])) if self.nm[i] > 0 else 0.0
        return self.starts[i] + share * self.minutes[i] * 60

    def along(self, lat: float, lon: float) -> float:
        """How far along these legs the point nearest (lat, lon) is."""
        return geo.along_path_nm(lat, lon, self.fixes)


def _span(legs: Legs, area) -> tuple[list[int], float, float] | None:
    """The legs that go through `area` (a shapely geometry in longitude
    and latitude), and the stretch from where the first goes in to
    where the last comes out (nm along). None where none does."""
    crossed, froms, tos = [], [], []
    offset = 0.0
    for i, ((a, b), d) in enumerate(zip(pairwise(legs.fixes), legs.nm)):
        seg = LineString([(a[1], a[0]), (b[1], b[0])])
        if seg.length == 0:
            offset += d
            continue
        inside = seg.intersection(area)
        if not inside.is_empty:
            shares = [seg.project(Point(xy)) / seg.length for xy in shapely.get_coordinates(inside)]
            if shares:
                crossed.append(i)
                froms.append(offset + min(shares) * d)
                tos.append(offset + max(shares) * d)
        offset += d
    if not crossed:
        return None
    return crossed, min(froms), max(tos)


def window_when(enter: float, leave: float, valid_from: float | None, valid_to: float | None) -> str | None:
    """Whether the airplane is in a hazard while it is valid: "during",
    "before" it starts or "after" it ends, its window widened by
    PASS_MARGIN_MIN either way (an ETA is an estimate). None where the
    hazard gives no window at all; one open at an end is open that way."""
    if valid_from is None and valid_to is None:
        return None
    margin = PASS_MARGIN_MIN * 60
    if valid_from is not None and leave < valid_from - margin:
        return "before"
    if valid_to is not None and enter > valid_to + margin:
        return "after"
    return "during"


def on_route(legs: Legs, crossed: list[int], from_nm: float, to_nm: float, *, source: str,
             valid_from: float | None = None, valid_to: float | None = None, issued: str | None = None) -> dict:
    """The OnRoute of a hazard met on `crossed` legs from `from_nm` to
    `to_nm` along."""
    enter, leave = legs.time_at(from_nm), legs.time_at(to_nm)
    return {
        "legs": sorted(set(crossed)),
        "from_nm": round(from_nm, 1), "to_nm": round(to_nm, 1),
        "enter": iso(enter), "leave": iso(leave),
        "valid_from": iso(valid_from), "valid_to": iso(valid_to),
        "when": window_when(enter, leave, valid_from, valid_to),
        "source": source, "issued": issued,
    }


def over_area(legs: Legs, area, fallback_nm: float | None = None, **kw) -> dict | None:
    """Where the legs meet `area`: the legs through it, or -- for one
    near the route and not on it, a TFR within its few miles, or an area
    the route as entered crosses and the nav log's line misses -- the
    point of the legs nearest it. With no usable area, the point
    `fallback_nm` along; None where there is neither."""
    if area is not None and not area.is_empty:
        span = _span(legs, area)
        if span is not None:
            return on_route(legs, *span, **kw)
        line = LineString([(lon, lat) for lat, lon in legs.fixes])
        near, _ = nearest_points(line, area)
        along = legs.along(near.y, near.x)
        return on_route(legs, [legs.leg_at(along)], along, along, **kw)
    if fallback_nm is not None:
        along = min(fallback_nm, legs.total_nm)
        return on_route(legs, [legs.leg_at(along)], along, along, **kw)
    return None


def at_point(legs: Legs, lat: float | None, lon: float | None, fallback_nm: float | None = None, **kw) -> dict | None:
    """Where the legs pass a point hazard (a pilot report, a station):
    the leg nearest it and the moment the airplane is abeam."""
    if lat is not None and lon is not None:
        along = legs.along(lat, lon)
    elif fallback_nm is not None:
        along = min(fallback_nm, legs.total_nm)
    else:
        return None
    return on_route(legs, [legs.leg_at(along)], along, along, **kw)


def polygon(coords: list | None):
    """A hazard's area from its [(lat, lon)] points, mended where it
    crosses itself; None for fewer than three."""
    if not coords or len(coords) < 3:
        return None
    area = Polygon([(lon, lat) for lat, lon in coords])
    return area if area.is_valid else area.buffer(0)


def geojson(geometry: dict | None):
    """A TFR's GeoJSON as a shapely geometry; None where it does not read."""
    try:
        return shape(geometry) if geometry else None
    except (KeyError, TypeError, ValueError, AttributeError, IndexError):
        return None


def sigmet_source(hazard: dict) -> str:
    """What kind of advisory the SIGMET file's entry is, in the names
    the AIM gives them (AIM 7-1-6, "the SIGMET, the Convective SIGMET,
    the AIRMET"): a convective SIGMET is its own."""
    kind = (hazard.get("type") or "SIGMET").upper()
    if kind == "SIGMET" and (hazard.get("hazard") or "").upper() == "CONVECTIVE":
        return "Convective SIGMET"
    return "AIRMET" if kind == "AIRMET" else "SIGMET"


def sigmets(legs: Legs, hazards: list[dict]) -> list[dict]:
    """Each SIGMET with where and when the flight meets it (`on_route`),
    its working keys (area, UNIX times) left off."""
    out = []
    for h in hazards:
        place = over_area(legs, polygon(h.get("coords")), source=sigmet_source(h),
                          valid_from=h.get("valid_from"), valid_to=h.get("valid_to"), issued=h.get("issued"))
        out.append({**{k: v for k, v in h.items() if k not in ("coords", "valid_from", "valid_to", "issued")},
                    "on_route": place})
    return out


def gairmets(legs: Legs, snapshots: list[dict], order: list[str]) -> list[dict]:
    """One G-AIRMET per hazard -- the snapshot valid nearest the time the
    airplane is in its area, since each stands for the hour and a half
    either side of it (GAIRMET_HALF_INTERVAL) -- with its `on_route`."""
    best: dict = {}
    for snap in snapshots:
        valid = snap.get("valid") or _unix(snap.get("valid_at"))
        place = over_area(legs, polygon(snap.get("coords")), source="G-AIRMET", issued=snap.get("issued"),
                          valid_from=valid - GAIRMET_HALF_INTERVAL.total_seconds() if valid else None,
                          valid_to=valid + GAIRMET_HALF_INTERVAL.total_seconds() if valid else None)
        if place is None or valid is None:
            at = legs.starts[0] if legs.starts else 0.0
        else:
            at = (_unix(place["enter"]) + _unix(place["leave"])) / 2
        miss = abs((valid or at) - at)
        held = best.get(snap["hazard"])
        if held is None or miss < held[0]:
            best[snap["hazard"]] = (miss, snap, place)
    rank = {name: i for i, name in enumerate(order)}
    return [
        {**{k: v for k, v in snap.items() if k not in ("valid", "coords")}, "on_route": place}
        for _, snap, place in sorted(best.values(), key=lambda b: rank.get(b[1]["hazard"], len(rank)))
    ]


def tfrs(legs: Legs, found: list[dict]) -> list[dict]:
    """Each TFR near the route with its `on_route`: the legs through it,
    or the point nearest it on one it is beside, against its NOTAM's
    times (in force from `effective` to `expires`, open-ended without)."""
    return [
        {**t, "on_route": over_area(
            legs, geojson(t.get("geometry")), t.get("along_track_nm"), source="TFR",
            valid_from=_unix(t.get("effective")), valid_to=_unix(t.get("expires")))}
        for t in found
    ]


def pireps(legs: Legs, found: list[dict]) -> list[dict]:
    """Each pilot report with its `on_route`: abeam where it was made. A
    report has no valid time, only when it was made (`issued`)."""
    return [
        {**p, "on_route": at_point(legs, p.get("lat"), p.get("lon"), p.get("along_track_nm"),
                                   source="PIREP", issued=p.get("observed_at"))}
        for p in found
    ]


def fields_below_vfr(legs: Legs, idents: list[str], destination: str, where: dict, metars: dict,
                     stations: list[dict], below) -> list[dict]:
    """The fields whose weather is below VFR where the flight meets them:
    each airport flown from or to reporting IFR or LIFR now (its METAR's
    flight category: AIM 7-1-7, IFR a ceiling under 1,000 ft or
    visibility under 3 miles, LIFR under 500 ft or 1 mile), and each TAF station along the
    route forecast under 14 CFR 91.155's basic minimums for when the
    airplane is there (`below`, vfr.weather.below_vfr_minimums). The
    departure is met at the start of the first leg, the destination at
    the end of the last, a stop at the end of the leg landing there."""
    out = []
    for k, ident in enumerate(idents):
        metar = metars.get(ident) or {}
        if metar.get("flight_category") not in ("IFR", "LIFR"):
            continue
        along = 0.0 if k == 0 else legs.total_nm if ident == destination else legs.along(*where[ident])
        out.append({
            "ident": ident, "source": "METAR", "flight_category": metar.get("flight_category"),
            "ceiling_ft": metar.get("ceiling_ft"), "visibility_sm": metar.get("visibility_sm"),
            "on_route": on_route(legs, [legs.leg_at(along)], along, along, source="METAR", issued=metar.get("observed_at")),
        })
    for s in stations:
        if not below(s.get("eta_ceiling_ft"), s.get("eta_visibility_sm")):
            continue
        place = at_point(legs, s.get("lat"), s.get("lon"), s.get("along_track_nm"), source="TAF")
        if place is None:
            continue
        out.append({
            "ident": s["icaoId"], "source": "TAF", "flight_category": None,
            "ceiling_ft": s.get("eta_ceiling_ft"), "visibility_sm": s.get("eta_visibility_sm"), "on_route": place,
        })
    return sorted(out, key=lambda f: f["on_route"]["from_nm"])
