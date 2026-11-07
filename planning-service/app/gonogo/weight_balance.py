"""The airplane's weight and balance (web/src/lib/weightBalance.ts): what
the pilot loads -- its own empty weight and arm (from its weight and
balance record), each station's pounds in the loading's order, and the
fuel at the start in gallons -- against its POH's loading: the weights,
the centre-of-gravity envelope and each station's most (the POH's
section 6; 14 CFR 91.9(a), its limitations). The sums and the problems in
words are the engine's (wingtip_engine::gonogo::weight_balance), asked by
name through wingtip_native.call, as the web app asks them."""
from . import ask


def default_load(loading: dict, fuel_gal: float) -> dict:
    """The loading's own sample (its POH's), and a pilot of 170 lb."""
    return ask("gonogo_default_load", loading=loading, fuel_gal=fuel_gal)


def balance(loading: dict, load: dict, trip_fuel_gal: float | None) -> dict:
    """The weight and centre of gravity at takeoff -- the ramp's, less the
    start and taxi fuel -- and at landing, less the trip's fuel, each
    against the loading's limits: the most it may weigh, the envelope,
    and each station's and the baggage's own most."""
    b = ask("gonogo_balance", loading=loading, load=load, trip_fuel_gal=trip_fuel_gal)
    del b["takeoff_words"]
    return b
