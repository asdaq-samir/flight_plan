"""A flight debriefed from its flown track (the roadmap's debrief, against
ACS PA.VI.A's tolerances): the saved flight's nav log is the plan, the
track what was flown. Leg by leg, how much of the cruise was within 200 ft
of the planned altitude and how much of the way the ground track was
within 15 degrees of the course, and how far off the line it went (within
3 nm, S5); at each checkpoint, when it was passed against when it was due
(within 5 minutes, S6) and how close; at each field landed at, the
altitude about where the downwind starts against the pattern's.

Deterministic: measured, not judged. GPS altitude is not the altimeter's
and a ground track is not a heading, so each figure is close to what the
examiner sees, not it -- the page says so.

web/src/lib/debrief.ts ported line for line: the two hold the same rules
and change together. Its checkpoints are the saved flight's (the gateway's
FlightCheckpointDto, as `sequence_no` and so on) and its points the
track's (TrackDto: `t` in ms since 1970, GPS altitude in feet)."""
import math

#: PA.VI.A's tolerances: S7's altitude, and its heading applied to the
#: ground track; S5's distance from the planned route; S6's time at each
#: checkpoint against its estimate.
ALTITUDE_FT = 200
COURSE_DEG = 15
OFF_ROUTE_NM = 3
ETA_MIN = 5
#: How near the field the downwind is taken to start, and PA.III.B.S5's
#: pattern altitude.
PATTERN_NM = 1.5
PATTERN_FT = 100
#: Slower than this over the ground, the airplane is on the ground (the
#: web's lib/map/glide AIRBORNE_KT): a fast taxi is under it, a light
#: single's slowest flight over it.
AIRBORNE_KT = 40

#: The mean earth radius in nautical miles, as the web's lib/geo.
EARTH_NM = 3440.065


def _rad(d: float) -> float:
    return d * math.pi / 180


def distance_nm(a: dict, b: dict) -> float:
    """Haversine, as the web's lib/geo distanceNm."""
    d_lat, d_lon = _rad(b["lat"] - a["lat"]), _rad(b["lon"] - a["lon"])
    h = math.sin(d_lat / 2) ** 2 + math.cos(_rad(a["lat"])) * math.cos(_rad(b["lat"])) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_NM * math.asin(min(1, math.sqrt(h)))


def bearing_deg(a: dict, b: dict) -> float:
    """The initial true bearing from a to b, as lib/geo bearingDeg."""
    d_lon = _rad(b["lon"] - a["lon"])
    y = math.sin(d_lon) * math.cos(_rad(b["lat"]))
    x = math.cos(_rad(a["lat"])) * math.sin(_rad(b["lat"])) - math.sin(_rad(a["lat"])) * math.cos(_rad(b["lat"])) * math.cos(d_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def angle_between(a: float, b: float) -> float:
    """How far apart two directions are, 0 to 180 (lib/geo angleBetween)."""
    d = ((a - b) % 360 + 360) % 360
    return 360 - d if d > 180 else d


def _ground_speeds(points: list[dict]) -> list[float]:
    """Ground speed at each point, knots: over at least ten seconds round
    it, which a one-second GPS's jitter would otherwise make a mess of."""
    out = []
    last = len(points) - 1
    for i in range(len(points)):
        j = k = i
        while points[k]["t"] - points[j]["t"] < 10_000 and (j > 0 or k < last):
            if j > 0:
                j -= 1
            if k < last:
                k += 1
        hours = (points[k]["t"] - points[j]["t"]) / 3_600_000
        out.append(distance_nm(points[j], points[k]) / hours if hours > 0 else 0)
    return out


def airborne(points: list[dict]) -> list[list[int]]:
    """The track's flights: each run of points over AIRBORNE_KT, as [first,
    last] indices, a minute's dip under it (a slow flight, a go-around)
    kept in, and a run of under a minute (a fast taxi) dropped."""
    runs: list[list[int]] = []
    for i, kt in enumerate(_ground_speeds(points)):
        if kt < AIRBORNE_KT:
            continue
        if runs and points[i]["t"] - points[runs[-1][1]]["t"] < 60_000:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    return [r for r in runs if points[r[1]]["t"] - points[r[0]]["t"] >= 60_000]


def _against(seg: dict, p: dict) -> dict:
    """Where a point is against a segment: how far along it (0 to 1), how
    far right of it (left negative), and how far from it at all. Flat over
    a leg, which is near enough at a leg's length."""
    f, to = seg["from"], seg["to"]
    kx = math.cos(_rad(f["lat"])) * 60
    bx, by = (to["lon"] - f["lon"]) * kx, (to["lat"] - f["lat"]) * 60
    px, py = (p["lon"] - f["lon"]) * kx, (p["lat"] - f["lat"]) * 60
    len2 = bx * bx + by * by
    t = (px * bx + py * by) / len2 if len2 > 0 else 0
    right = -(bx * py - by * px) / math.sqrt(len2) if len2 > 0 else math.hypot(px, py)
    away = math.hypot(px, py) if t < 0 else math.hypot(px - bx, py - by) if t > 1 else abs(right)
    return {"t": min(1, max(0, t)), "right": right, "away": away}


def _hops(cps: list[dict]) -> list[tuple[int, int]]:
    """The flight's hops, by checkpoint index: from each field taken off
    from to the next landed at."""
    fields = [i for i, c in enumerate(cps) if i == 0 or i == len(cps) - 1 or c["category"] == "stop"]
    return [(fields[h], end) for h, end in enumerate(fields[1:])]


def debrief(checkpoints: list[dict], points: list[dict], patterns: dict[str, float] | None = None) -> dict | None:
    """A flight debriefed against its track; None where the track never
    flew. `patterns` are the fields' pattern altitudes, ft MSL, by ident."""
    patterns = patterns or {}
    cps = sorted(checkpoints, key=lambda c: c["sequence_no"])
    runs = airborne(points)
    if len(cps) < 2 or not runs:
        return None
    leg_hops = _hops(cps)
    notes: list[str] = []
    # Each hop its own flight where the track has as many; else the whole
    # track one flight, its times from the first takeoff.
    if len(runs) == len(leg_hops):
        flights = runs
    else:
        flights = [[runs[0][0], runs[-1][1]] for _ in leg_hops]
        if len(leg_hops) > 1:
            notes.append(f"The track has {len(runs)} flight{'' if len(runs) == 1 else 's'} for the plan's {len(leg_hops)}: "
                         "times are from the first takeoff.")
    first, last = points[flights[0][0]], points[flights[-1][1]]
    off_start, off_end = distance_nm(first, cps[0]), distance_nm(last, cps[-1])
    if off_start > 5:
        notes.append(f"The track takes off {off_start:.0f} nm from {cps[0]['name']}: is it this flight's?")
    if off_end > 5:
        notes.append(f"The track lands {off_end:.0f} nm from {cps[-1]['name']}.")

    segments = [{"index": i, "from": cps[i], "to": to, "hop": next((h for h, (a, b) in enumerate(leg_hops) if a <= i < b), -1)}
                for i, to in enumerate(cps[1:])]
    has_altitude = any(p.get("alt_ft") is not None for p in points)
    grades = [{"alt_w": 0.0, "alt_in": 0.0, "worst_alt": None, "course_w": 0.0, "course_in": 0.0, "worst_off": None} for _ in segments]
    profile: list[dict] = []
    line: list[dict] = []
    passed: dict[int, float] = {}
    passes: list[dict] = []
    entries: list[dict] = []

    for h, (a, b) in enumerate(leg_hops):
        start, end = flights[h]
        hop_segs = [s for s in segments if s["hop"] == h]
        # The cruise: from first reaching the first leg's altitude to last
        # being at the last leg's, before the landing.
        first_alt = cps[a + 1].get("altitude_ft") if a + 1 < len(cps) else None
        last_alt = cps[b].get("altitude_ft")
        cruise_from, cruise_to = math.inf, -math.inf
        for i in range(start, end + 1):
            alt = points[i].get("alt_ft")
            if alt is None:
                continue
            if first_alt is not None and cruise_from == math.inf and alt >= first_alt - ALTITUDE_FT:
                cruise_from = points[i]["t"]
            if last_alt is not None and alt >= last_alt - ALTITUDE_FT:
                cruise_to = points[i]["t"]
        cursor = 0
        prev_along = cps[a]["along_track_nm"]
        prev_t = points[start]["t"]
        for i in range(start, end + 1):
            p = points[i]
            # The nearest of the legs about where it was, so a route that
            # doubles back is not read on its way out as on its way home.
            best = hop_segs[cursor]
            where = _against(best, p)
            for s in range(max(0, cursor - 1), min(len(hop_segs) - 1, cursor + 3) + 1):
                w = _against(hop_segs[s], p)
                if w["away"] < where["away"]:
                    best, where = hop_segs[s], w
            cursor = hop_segs.index(best)
            along = best["from"]["along_track_nm"] + where["t"] * (best["to"]["along_track_nm"] - best["from"]["along_track_nm"])
            # Each checkpoint passed: when the track first got past it.
            for k in range(a + 1, b):
                cp = cps[k]
                if k not in passed and along >= cp["along_track_nm"] > prev_along:
                    share = (cp["along_track_nm"] - prev_along) / (along - prev_along) if along > prev_along else 0
                    passed[k] = prev_t + share * (p["t"] - prev_t)
            prev_along, prev_t = along, p["t"]
            weight = min(30_000, points[i + 1]["t"] - p["t"]) if i < end else 0
            g = grades[best["index"]]
            since_leg_start = along - best["from"]["along_track_nm"]
            to_field, from_field = cps[b]["along_track_nm"] - along, along - cps[a]["along_track_nm"]
            # Course: not over the fields, nor in the turn onto a leg.
            course = best["to"].get("true_course_deg")
            if course is not None and from_field > 2 and to_field > 2 and since_leg_start > 1:
                j = k = i
                while points[k]["t"] - points[j]["t"] < 20_000 and (j > start or k < end):
                    if j > start:
                        j -= 1
                    if k < end:
                        k += 1
                if k > j:
                    off = angle_between(bearing_deg(points[j], points[k]), course)
                    g["course_w"] += weight
                    if off <= COURSE_DEG:
                        g["course_in"] += weight
                if g["worst_off"] is None or abs(where["right"]) > abs(g["worst_off"]):
                    g["worst_off"] = where["right"]
            # Altitude: in the cruise, and not in a step to a new one.
            planned = best["to"].get("altitude_ft")
            stepped = best["index"] > a and cps[best["index"]].get("altitude_ft") != planned and since_leg_start < 3
            off_line = abs(where["right"]) > OFF_ROUTE_NM and from_field > 2 and to_field > 2
            alt = p.get("alt_ft")
            if alt is not None and planned is not None and cruise_from <= p["t"] <= cruise_to and not stepped:
                dev = alt - planned
                g["alt_w"] += weight
                if abs(dev) <= ALTITUDE_FT:
                    g["alt_in"] += weight
                else:
                    off_line = True
                if g["worst_alt"] is None or abs(dev) > abs(g["worst_alt"]):
                    g["worst_alt"] = dev
            line.append({"lat": p["lat"], "lon": p["lon"], "off": off_line})
            if alt is not None:
                profile.append({"along_nm": along, "alt_ft": alt})

        # The checkpoints' times, from this hop's takeoff.
        due: float | None = 0
        for k in range(a + 1, b + 1):
            cp = cps[k]
            due = None if cp.get("ete_min") is None or due is None else due + cp["ete_min"]
            at = points[end]["t"] if k == b else passed.get(k)
            closest = min((distance_nm(points[i], cp) for i in range(start, end + 1)), default=math.inf)
            passes.append({
                "name": cp["name"], "category": cp["category"],
                "due_min": due,
                "passed_min": None if at is None else (at - points[start]["t"]) / 60_000,
                "closest_nm": closest if math.isfinite(closest) else None,
            })

        # The pattern: the altitude where it first came within PATTERN_NM of
        # the field it landed at.
        field = cps[b]
        pattern_ft = patterns.get(field["name"])
        if pattern_ft is not None:
            for i in range(start, end + 1):
                alt = points[i].get("alt_ft")
                if alt is not None and distance_nm(points[i], field) <= PATTERN_NM:
                    entries.append({"ident": field["name"], "alt_ft": alt, "pattern_ft": pattern_ft})
                    break

    legs = []
    for s, g in zip(segments, grades):
        legs.append({
            "from": s["from"]["name"], "to": s["to"]["name"],
            "planned_alt_ft": s["to"].get("altitude_ft"),
            "altitude_within": g["alt_in"] / g["alt_w"] if g["alt_w"] > 0 else None,
            "worst_alt_ft": g["worst_alt"],
            "course_deg": s["to"].get("true_course_deg"),
            "course_within": g["course_in"] / g["course_w"] if g["course_w"] > 0 else None,
            "worst_off_nm": g["worst_off"],
        })
    flown_ms = sum(points[b]["t"] - points[a]["t"] for h, (a, b) in enumerate(flights) if not (h > 0 and flights[h - 1][0] == a))
    planned_min: float | None = 0
    for c in cps[1:]:
        planned_min = None if planned_min is None or c.get("ete_min") is None else planned_min + c["ete_min"]
    # At most 400 points on the profile and 1,500 on the map: they are
    # drawn, not read. An off point is never thinned out of the map's.
    stride = max(1, math.ceil(len(profile) / 400))
    line_stride = max(1, math.ceil(len(line) / 1500))
    return {
        "takeoff": first["t"], "landing": last["t"], "flown_min": flown_ms / 60_000, "planned_min": planned_min,
        "legs": legs, "passes": passes, "patterns": entries,
        "profile": [pt for i, pt in enumerate(profile) if i % stride == 0],
        "planned": [{"from_nm": s["from"]["along_track_nm"], "to_nm": s["to"]["along_track_nm"], "alt_ft": s["to"].get("altitude_ft")}
                    for s in segments],
        "line": [pt for i, pt in enumerate(line) if pt["off"] or i % line_stride == 0 or i == len(line) - 1],
        "has_altitude": has_altitude, "notes": notes,
    }


def marked(d: dict) -> dict:
    """The debrief with each finding's mark as the web's FlightPage gives
    it beside the finding: a leg is within where neither its altitude nor
    its distance off the route went past PA.VI.A's tolerance; a
    checkpoint where it was passed within ETA_MIN of its estimate (none
    where either time is not known); a pattern within PATTERN_FT. So the
    native app shows the marks and states no tolerance of its own."""
    legs = [{**leg, "ok": (leg["worst_alt_ft"] is None or abs(leg["worst_alt_ft"]) <= ALTITUDE_FT)
             and (leg["worst_off_nm"] is None or abs(leg["worst_off_nm"]) <= OFF_ROUTE_NM)} for leg in d["legs"]]
    passes = []
    for p in d["passes"]:
        late = p["passed_min"] - p["due_min"] if p["due_min"] is not None and p["passed_min"] is not None else None
        passes.append({**p, "landed": p["category"] in ("destination", "stop"), "late_min": late,
                       "ok": None if late is None else abs(late) <= ETA_MIN})
    patterns = [{**e, "off_ft": e["alt_ft"] - e["pattern_ft"], "ok": abs(e["alt_ft"] - e["pattern_ft"]) <= PATTERN_FT}
                for e in d["patterns"]]
    return {**d, "legs": legs, "passes": passes, "patterns": patterns}
