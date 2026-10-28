"""The airplane's weight and balance (web/src/lib/weightBalance.ts): what
the pilot loads -- its own empty weight and arm (from its weight and
balance record), each station's pounds in the loading's order, and the
fuel at the start in gallons -- against its POH's loading: the weights,
the centre-of-gravity envelope and each station's most (the POH's
section 6; 14 CFR 91.9(a), its limitations)."""
from .words import grouped, js_round, num, to_fixed


def default_load(loading: dict, fuel_gal: float) -> dict:
    """The loading's own sample (its POH's), and a pilot of 170 lb."""
    return {
        "empty_weight_lb": loading["sample_empty_weight_lb"],
        "empty_arm_in": js_round(loading["sample_empty_moment_lb_in"] / loading["sample_empty_weight_lb"] * 100) / 100,
        "stations_lb": [170 if i == 0 else 0 for i, _ in enumerate(loading["stations"])],
        "fuel_gal": min(fuel_gal, loading["fuel_max_gal"]),
    }


def _limits_at(envelope: list, weight: float) -> tuple[float, float] | None:
    """The forward and aft limits at a weight: the envelope's edges there."""
    arms = []
    j = len(envelope) - 1
    for i in range(len(envelope)):
        xi, yi = envelope[i]
        xj, yj = envelope[j]
        if (yi <= weight <= yj) or (yj <= weight <= yi):
            arms.append(min(xi, xj) if yi == yj else xi + (xj - xi) * (weight - yi) / (yj - yi))
            if yi == yj:
                arms.append(max(xi, xj))
        j = i
    return (min(arms), max(arms)) if arms else None


def in_envelope(envelope: list, arm: float, weight: float) -> bool:
    """Whether an (arm, weight) point is within the envelope, its edges
    included: the POH's sample loading sits on its top, at 2,550 lb."""
    limits = _limits_at(envelope, weight)
    return bool(limits) and limits[0] - 1e-6 <= arm <= limits[1] + 1e-6


def _pounds(n: float) -> str:
    return f"{grouped(n)} lb"


def balance(loading: dict, load: dict, trip_fuel_gal: float | None) -> dict:
    """The weight and centre of gravity at takeoff -- the ramp's, less the
    start and taxi fuel -- and at landing, less the trip's fuel, each
    against the loading's limits: the most it may weigh, the envelope,
    and each station's and the baggage's own most."""
    # Avgas's standard 6 lb a gallon (FAA-H-8083-1B, Aircraft Weight and
    # Balance Handbook), where the airplane's handbook gives none.
    lb_per_gal = loading.get("fuel_lb_per_gal", 6.0)
    taxi_lb = loading.get("start_taxi_fuel_lb", 0.0)
    stations = loading["stations"]
    stations_lb = load["stations_lb"]

    def at(i):
        return stations_lb[i] if i < len(stations_lb) and stations_lb[i] is not None else 0

    fuel_lb = load["fuel_gal"] * lb_per_gal
    weight = load["empty_weight_lb"] + fuel_lb
    moment = load["empty_weight_lb"] * load["empty_arm_in"] + fuel_lb * loading["fuel_arm_in"]
    for i, station in enumerate(stations):
        weight += at(i)
        moment += at(i) * station["arm_in"]
    takeoff_weight = weight - taxi_lb
    takeoff_moment = moment - taxi_lb * loading["fuel_arm_in"]
    burned_lb = min(fuel_lb - taxi_lb, (trip_fuel_gal or 0) * lb_per_gal)
    landing_weight = takeoff_weight - burned_lb
    landing_moment = takeoff_moment - burned_lb * loading["fuel_arm_in"]
    takeoff = {"weight_lb": takeoff_weight, "arm_in": takeoff_moment / takeoff_weight}
    landing = {"weight_lb": landing_weight, "arm_in": landing_moment / landing_weight}

    problems = []
    envelope = loading["envelope"]
    if weight > loading["max_ramp_lb"]:
        problems.append(f"The ramp weight, {_pounds(weight)}, is over its most, {_pounds(loading['max_ramp_lb'])}")
    if takeoff["weight_lb"] > loading["max_takeoff_lb"]:
        problems.append(f"The takeoff weight, {_pounds(takeoff['weight_lb'])}, is "
                        f"{_pounds(takeoff['weight_lb'] - loading['max_takeoff_lb'])} over its most")
    if landing["weight_lb"] > loading["max_landing_lb"]:
        problems.append(f"The landing weight, {_pounds(landing['weight_lb'])}, is "
                        f"{_pounds(landing['weight_lb'] - loading['max_landing_lb'])} over its most")
    heaviest = max(p[1] for p in envelope)
    for name, c in (("takeoff", takeoff), ("landing", landing)):
        if c["weight_lb"] > heaviest:
            continue   # said above, as a weight
        if not in_envelope(envelope, c["arm_in"], c["weight_lb"]):
            limits = _limits_at(envelope, c["weight_lb"])
            side = (f"forward of its limit, {to_fixed(limits[0])} in" if limits and c["arm_in"] < limits[0]
                    else f"aft of its limit, {to_fixed(limits[1])} in" if limits else "outside the envelope")
            problems.append(f"At {name} the centre of gravity, {to_fixed(c['arm_in'])} in, is {side}")
    for i, station in enumerate(stations):
        if station.get("max_lb") is not None and at(i) > station["max_lb"]:
            problems.append(f"{station['name']} holds {_pounds(at(i))}, over its {_pounds(station['max_lb'])}")
    baggage = sum(at(i) for i, s in enumerate(stations) if s["name"].lower().startswith("baggage"))
    if loading.get("baggage_combined_max_lb") is not None and baggage > loading["baggage_combined_max_lb"]:
        problems.append(f"The baggage, {_pounds(baggage)} in all, is over its {_pounds(loading['baggage_combined_max_lb'])}")
    if load["fuel_gal"] > loading["fuel_max_gal"]:
        problems.append(f"{num(load['fuel_gal'])} gal is more than the tanks' usable {num(loading['fuel_max_gal'])}")
    return {"takeoff": takeoff, "landing": landing, "problems": problems}
