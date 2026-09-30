"""A light piston aeroplane in the day's air: the power its engine makes
at an altitude, what that power flies at and burns, and how fast it
climbs -- from the density altitude, which the forecast temperature
aloft gives (vfr.weather.temperature_at_altitude).

A profile's cruise TAS and fuel burn -- a stock one's, or a pilot's own
aeroplane's laid over it -- are taken as the aeroplane's at its cruise
power (`cruise_power_pct`, DEFAULT_CRUISE_POWER_PCT where it names none)
at REFERENCE_ALTITUDE_FT on a standard day: a row of a handbook's cruise
table. From there, at any altitude in any air:

- Power is the cruise power, or what full throttle makes where the air
  is too thin for it: a normally aspirated engine's fraction of its
  sea-level power, 1.132 sigma - 0.132 (Gagg and Ferrar), sigma being
  the air's density over a standard day's at sea level.
- True airspeed goes as the cube root of power over density: the power
  level flight takes goes as density times TAS cubed, the parasite drag
  that most of a light aeroplane's drag at cruise is.
- Fuel flow goes with power: a leaned engine burns much the same per
  horsepower at any altitude.
- A climb's best rate falls in a straight line with density altitude,
  from the sea-level figure to 100 fpm at the service ceiling, which is
  that by definition. It burns the climb's sea-level fuel flow in
  proportion to full-throttle power, at the climb speed.

Pressure altitude is taken as the altitude itself: the winds/temps
forecast gives no pressure, and a METAR's altimeter setting is now's,
not the flight's. A density altitude here is the altitude corrected for
the forecast temperature alone, about 120 ft per degree off standard.

A model, not the handbook: within a few percent of a light single's
book figures, and the handbook governs.
"""
from functools import lru_cache
from typing import NamedTuple

#: The altitude a profile's cruise TAS and fuel burn are the aeroplane's
#: at, on a standard day: the middle of where a light single cruises
#: across country, and a row of every handbook's cruise table.
REFERENCE_ALTITUDE_FT = 6000.0
#: The cruise power of a profile that names none.
DEFAULT_CRUISE_POWER_PCT = 65.0
#: The sea-level climb rate of a profile that gives none.
DEFAULT_CLIMB_RATE_FPM = 500.0
#: What the best climb has fallen to at the service ceiling, by the
#: ceiling's definition.
SERVICE_CEILING_CLIMB_FPM = 100.0
#: The slowest climb flown. Past the service ceiling -- only a pilot's
#: own altitude goes there, the plans keep under it -- the straight line
#: runs down to nothing, and a climb that never ends is no nav log.
MIN_CLIMB_RATE_FPM = 50.0
#: Climb speed as a fraction of cruise TAS where the profile has none
#: (Vy is around 70% of cruise on a C172 or an Archer).
DEFAULT_CLIMB_TAS_FRACTION = 0.7
#: A climb at full power burns more than cruise; the book figure for a
#: light single is around a third more. For a profile, or a pilot's own
#: aeroplane, with no climb burn of its own.
CLIMB_FUEL_FACTOR = 1.3
#: The least power a leg is flown at: full throttle makes next to
#: nothing far above anywhere a light aeroplane goes, and a pilot's own
#: altitude can be typed there.
MIN_POWER_FRACTION = 0.05

# The International Standard Atmosphere, below the tropopause.
ISA_SEA_LEVEL_C = 15.0
ISA_LAPSE_C_PER_FT = 0.0019812
_SEA_LEVEL_K = 288.15
_LAPSE_OVER_T0_PER_FT = 6.8755856e-6
_PRESSURE_EXPONENT = 5.2558797
# The altitudes the formulas are asked at: below the lowest field, and
# above anything flown, where the pressure formula stops meaning much
# (and, far enough up, stops being a number).
_LOWEST_FT = -2000.0
_HIGHEST_FT = 60000.0


def isa_temp_c(altitude_ft: float) -> float:
    """A standard day's temperature at a pressure altitude."""
    return ISA_SEA_LEVEL_C - ISA_LAPSE_C_PER_FT * altitude_ft


def density_ratio(altitude_ft: float, oat_c: float) -> float:
    """Sigma: the air's density at a pressure altitude and temperature,
    over a standard day's at sea level."""
    altitude_ft = min(max(altitude_ft, _LOWEST_FT), _HIGHEST_FT)
    pressure_ratio = (1 - _LAPSE_OVER_T0_PER_FT * altitude_ft) ** _PRESSURE_EXPONENT
    return pressure_ratio * _SEA_LEVEL_K / (oat_c + 273.15)


def density_altitude_ft(sigma: float) -> float:
    """The altitude at which a standard day's air has density sigma."""
    return (1 - sigma ** (1 / (_PRESSURE_EXPONENT - 1))) / _LAPSE_OVER_T0_PER_FT


def full_throttle_power(sigma: float) -> float:
    """What a normally aspirated engine makes at full throttle in air of
    density sigma, as a fraction of its sea-level power (Gagg and
    Ferrar)."""
    return max(0.0, 1.132 * sigma - 0.132)


def cruise_power_pct(aircraft_profile: dict) -> float:
    return aircraft_profile.get("cruise_power_pct") or DEFAULT_CRUISE_POWER_PCT


class Cruise(NamedTuple):
    tas_kt: float
    fuel_burn_gph: float
    #: The power flown: the cruise power, or less where full throttle
    #: cannot make it.
    power_pct: float
    density_altitude_ft: float


def cruise(aircraft_profile: dict, altitude_ft: float, oat_c: float | None = None) -> Cruise:
    """The profile's cruise at `altitude_ft` in air at `oat_c` -- a
    standard day's where None, i.e. no forecast -- from its figures at
    the reference altitude."""
    altitude_ft = min(max(altitude_ft, _LOWEST_FT), _HIGHEST_FT)
    setting = cruise_power_pct(aircraft_profile) / 100
    sigma_ref = density_ratio(REFERENCE_ALTITUDE_FT, isa_temp_c(REFERENCE_ALTITUDE_FT))
    # The figures are at the cruise power, or at full throttle where a
    # setting above what the engine makes up there was given.
    power_ref = min(setting, full_throttle_power(sigma_ref))
    sigma = density_ratio(altitude_ft, isa_temp_c(altitude_ft) if oat_c is None else oat_c)
    power = max(min(setting, full_throttle_power(sigma)), MIN_POWER_FRACTION)
    return Cruise(
        tas_kt=aircraft_profile["cruise_tas_kt"] * (power / power_ref * sigma_ref / sigma) ** (1 / 3),
        fuel_burn_gph=aircraft_profile["fuel_burn_gph"] * power / power_ref,
        power_pct=power * 100,
        density_altitude_ft=density_altitude_ft(sigma),
    )


def climb_tas_kt(aircraft_profile: dict) -> float:
    return aircraft_profile.get("climb_tas_kt") or DEFAULT_CLIMB_TAS_FRACTION * aircraft_profile["cruise_tas_kt"]


def climb_burn_gph(aircraft_profile: dict) -> float:
    """The climb's fuel flow at sea level: the profile's (a pilot's own
    aeroplane's) `climb_fuel_burn_gph`, or CLIMB_FUEL_FACTOR times the
    cruise burn."""
    return aircraft_profile.get("climb_fuel_burn_gph") or CLIMB_FUEL_FACTOR * aircraft_profile["fuel_burn_gph"]


def _climb_rate(sea_level_fpm: float, ceiling_ft: float, density_altitude: float) -> float:
    rate = sea_level_fpm - (sea_level_fpm - SERVICE_CEILING_CLIMB_FPM) * density_altitude / ceiling_ft
    return max(MIN_CLIMB_RATE_FPM, rate)


def climb_rate_fpm(aircraft_profile: dict, density_altitude: float) -> float:
    """The best climb rate at a density altitude: the profile's
    sea-level `climb_rate_fpm_sea_level`, falling in a straight line to
    100 fpm at its service ceiling."""
    sea_level = aircraft_profile.get("climb_rate_fpm_sea_level") or DEFAULT_CLIMB_RATE_FPM
    return _climb_rate(sea_level, aircraft_profile["service_ceiling_ft"], density_altitude)


class Climb(NamedTuple):
    minutes: float
    gallons: float


# A climb's minutes and gallons, summed from the bottom of the table up
# in steps, for one aeroplane in one air: the plans price a climb
# between every pair of a leg's altitudes, and each is the difference of
# two sums, where it was an integration of its own.
_TABLE_STEP_FT = 100.0
_TABLE_TOP_FT = 30000.0


@lru_cache(maxsize=256)
def _climb_table(sea_level_fpm: float, ceiling_ft: float, burn_gph: float, isa_dev_c: float) -> tuple:
    minutes, gallons = [0.0], [0.0]
    for k in range(round((_TABLE_TOP_FT - _LOWEST_FT) / _TABLE_STEP_FT)):
        mid_ft = _LOWEST_FT + (k + 0.5) * _TABLE_STEP_FT
        sigma = density_ratio(mid_ft, isa_temp_c(mid_ft) + isa_dev_c)
        step_min = _TABLE_STEP_FT / _climb_rate(sea_level_fpm, ceiling_ft, density_altitude_ft(sigma))
        minutes.append(minutes[-1] + step_min)
        gallons.append(gallons[-1] + step_min / 60 * burn_gph * full_throttle_power(sigma))
    return tuple(minutes), tuple(gallons)


def _summed(table: tuple, altitude_ft: float) -> float:
    x = (min(max(altitude_ft, _LOWEST_FT), _TABLE_TOP_FT) - _LOWEST_FT) / _TABLE_STEP_FT
    i = min(int(x), len(table) - 2)
    return table[i] + (x - i) * (table[i + 1] - table[i])


def climb(aircraft_profile: dict, from_ft: float, to_ft: float, isa_dev_c: float = 0.0) -> Climb:
    """The minutes and gallons of a best-rate climb from `from_ft` to
    `to_ft`, in air `isa_dev_c` warmer than a standard day's all the way
    up (a leg's forecast difference, carried at the standard lapse
    rate); nothing for a descent."""
    if to_ft <= from_ft:
        return Climb(0.0, 0.0)
    minutes, gallons = _climb_table(
        aircraft_profile.get("climb_rate_fpm_sea_level") or DEFAULT_CLIMB_RATE_FPM,
        aircraft_profile["service_ceiling_ft"], climb_burn_gph(aircraft_profile),
        # A table per half degree of air.
        round(isa_dev_c * 2) / 2,
    )
    return Climb(
        _summed(minutes, to_ft) - _summed(minutes, from_ft),
        _summed(gallons, to_ft) - _summed(gallons, from_ft),
    )


def altitude_at_density_altitude(density_altitude: float, temp_at) -> float:
    """The altitude whose density altitude is `density_altitude` in air
    whose temperature at an altitude is `temp_at(altitude_ft)` -- where
    the service ceiling is on the day. Density altitude rises with
    altitude in any air an aeroplane flies in, so it is found by
    halving."""
    low, high = _LOWEST_FT, density_altitude + 10000.0
    for _ in range(40):
        mid = (low + high) / 2
        if density_altitude_ft(density_ratio(mid, temp_at(mid))) < density_altitude:
            low = mid
        else:
            high = mid
    return (low + high) / 2
