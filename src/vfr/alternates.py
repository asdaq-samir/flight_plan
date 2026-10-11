"""The IFR alternate: whether the destination needs one, and whether an
airport will do as one -- 14 CFR 91.169, read from the TAFs and the
FAA's terminal procedures (the d-TPP, vfr.publications).

**The destination** (91.169(b)): no alternate is needed where Part 97
publishes an instrument approach to it and the forecast, for at least an
hour before and an hour after the ETA, is a ceiling of at least 2,000 ft
above the field and a visibility of at least 3 sm -- "1-2-3". Read here
from the destination's TAF over those two hours, its TEMPO and PROB
groups included (vfr.weather's worst in the window), so a TEMPO below
either figure asks for an alternate: the stricter reading, as the rule
does not say which. No TAF, or none covering the window, says nothing
about it, and an alternate is then needed.

**The alternate** (91.169(c)(1)): at the ETA there, a forecast at or
above its alternate minimums -- the ones its procedures publish, or
where none are (no "A" on its charts) the standard 600 ft and 2 sm with
a precision approach, 800 ft and 2 sm without. An ILS is the precision
approach counted here, as Part 97 has it; an RNAV approach to LPV minima
is not, so it counts as nonprecision, the stricter. Where the FAA
publishes nonstandard alternate minimums for the field (its "ALTERNATE
MINIMUMS" page in the d-TPP), they may be higher or "NA", so the field
is not called good: the pilot is sent to that page. An airport with no
instrument approach (91.169(c)(2)) is only good with a descent from the
MEA and a landing under basic VFR, which the planner does not work out:
it is not offered, and not called good.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import geo, publications, weather

#: 91.169(b)(2)(i): an hour either side of the ETA, 2,000 ft and 3 sm.
DESTINATION_WINDOW_S = 3600
DESTINATION_CEILING_FT = 2000
DESTINATION_VISIBILITY_SM = 3

#: 91.169(c)(1)(i)(A) and (B): the standard alternate minimums.
PRECISION_MINIMUMS = (600, 2)
NONPRECISION_MINIMUMS = (800, 2)

#: Alternates offered within this of the destination.
NEAR_NM = 100.0


@dataclass(frozen=True)
class Approaches:
    """A field's instrument approaches as the d-TPP lists them: whether it
    has any, whether one is a precision approach (an ILS), and its
    nonstandard alternate minimums' page, where it has one."""

    any: bool
    precision: bool
    alternate_minimums_url: str | None


def approaches(ident: str) -> Approaches:
    charts = publications.terminal_charts(ident)
    iaps = [c["name"].upper() for c in charts if c["kind"] == "IAP"]
    page = next((c["url"] for c in charts if c["kind"] == "MIN" and "ALTERNATE" in c["name"].upper()), None)
    return Approaches(
        any=bool(iaps),
        precision=any(name.startswith(("ILS", "GLS", "PAR")) for name in iaps),
        alternate_minimums_url=page,
    )


def _forecast(ident: str, start: float, end: float) -> dict | None:
    """The worst the field's TAF forecasts over [start, end] (vfr.weather),
    with the TAF as issued; None where the field has no TAF, or none of
    its periods covers the window."""
    station = next((s for s in weather._dataset("tafs") if s["icaoId"] == ident.upper()), None)
    if station is None:
        return None
    worst = weather._worst_in_window(station["fcsts"], start, end)
    return None if worst is None else {**worst, "raw": station.get("raw")}


def destination(ident: str, eta: float) -> dict:
    """Whether the destination needs an alternate (91.169(b)), and why."""
    procs = approaches(ident)
    forecast = _forecast(ident, eta - DESTINATION_WINDOW_S, eta + DESTINATION_WINDOW_S)
    reasons: list[str] = []
    if not procs.any:
        reasons.append(f"{ident} has no instrument approach published (14 CFR 91.169(b)(1)).")
    if forecast is None:
        reasons.append(f"No TAF for {ident} covers an hour either side of the ETA.")
    else:
        ceiling, visibility = forecast.get("ceiling_ft"), forecast.get("visibility_sm")
        if ceiling is not None and ceiling < DESTINATION_CEILING_FT:
            reasons.append(f"The TAF has a {ceiling:,.0f} ft ceiling within an hour of the ETA: under 2,000 ft.")
        if visibility is not None and visibility < DESTINATION_VISIBILITY_SM:
            reasons.append(f"The TAF has {visibility:g} sm within an hour of the ETA: under 3 sm.")
    return {
        "ident": ident,
        "approach": procs.any,
        "ceiling_ft": None if forecast is None else forecast.get("ceiling_ft"),
        "visibility_sm": None if forecast is None else forecast.get("visibility_sm"),
        "taf": None if forecast is None else forecast.get("raw"),
        "required": bool(reasons),
        "reasons": reasons,
    }


def alternate(ident: str, eta: float) -> dict:
    """Whether a field will do as the alternate at `eta` (91.169(c)):
    `good` True, False, or None where the pilot has to look (nonstandard
    minimums, no approach, no TAF), with why."""
    procs = approaches(ident)
    forecast = _forecast(ident, eta, eta)
    minimums = PRECISION_MINIMUMS if procs.precision else NONPRECISION_MINIMUMS
    reasons: list[str] = []
    good: bool | None = True
    if not procs.any:
        good = None
        reasons.append(f"{ident} has no instrument approach: the forecast must allow a descent from the MEA and a "
                       "landing under basic VFR (14 CFR 91.169(c)(2)).")
    if forecast is None:
        good = None
        reasons.append(f"No TAF for {ident} covers the ETA there.")
    elif procs.any:
        ceiling, visibility = forecast.get("ceiling_ft"), forecast.get("visibility_sm")
        if ceiling is not None and ceiling < minimums[0]:
            good = False
            reasons.append(f"The TAF has a {ceiling:,.0f} ft ceiling at the ETA: under {minimums[0]} ft.")
        if visibility is not None and visibility < minimums[1]:
            good = False
            reasons.append(f"The TAF has {visibility:g} sm at the ETA: under {minimums[1]} sm.")
    # Whether the forecast meets the standard minimums, said apart from
    # `good`: a field with its own minimums may still be offered, for the
    # pilot to check against them.
    meets_standard = good is True and procs.any
    if procs.alternate_minimums_url and good:
        good = None
        reasons.append(f"{ident} publishes its own alternate minimums, higher than standard or not authorized "
                       "for some approaches: check its alternate minimums page.")
    return {
        "ident": ident,
        "approach": procs.any,
        "precision": procs.precision,
        "minimums": {"ceiling_ft": minimums[0], "visibility_sm": minimums[1]} if procs.any else None,
        "alternate_minimums_url": procs.alternate_minimums_url,
        "ceiling_ft": None if forecast is None else forecast.get("ceiling_ft"),
        "visibility_sm": None if forecast is None else forecast.get("visibility_sm"),
        "taf": None if forecast is None else forecast.get("raw"),
        "good": good,
        "meets_standard": meets_standard,
        "reasons": reasons,
    }


def nearby(dest: tuple[float, float], dest_ident: str, eta_of, limit: int = 5) -> list[dict]:
    """The fields with a TAF within NEAR_NM of the destination that will do
    as its alternate, or that meet the standard minimums and publish their
    own for the pilot to check -- those that will do first, then nearest
    first: `eta_of(lat, lon)` the ETA there."""
    stations = [
        s for s in weather._dataset("tafs")
        if s["icaoId"] != dest_ident and geo.distance_nm(*dest, s["lat"], s["lon"]) <= NEAR_NM
    ]
    stations.sort(key=lambda s: geo.distance_nm(*dest, s["lat"], s["lon"]))
    found = []
    for station in stations:
        check = alternate(station["icaoId"], eta_of(station["lat"], station["lon"]))
        if check["good"] or (check["good"] is None and check["meets_standard"]):
            found.append({**check, "distance_nm": round(geo.distance_nm(*dest, station["lat"], station["lon"]), 1)})
        if len(found) >= limit * 2:
            break
    found.sort(key=lambda f: (f["good"] is not True, f["distance_nm"]))
    return found[:limit]
