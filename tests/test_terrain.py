"""terrain.floor_profile: the MEF-style floor of each leg, from the terrain
sampled along the line and the registered obstacles near it. Written to
pin its behaviour before its inner loop was vectorised: the elevation
lookup is replaced with flat ground, and the obstacles are a real DOF
file of a few lines."""
import pytest

from vfr import elevation, faa_data, geo, terrain

START, END = (45.0, -90.0), (45.0, -89.0)   # due east, about 42.4 nm
GROUND_M = 300.0                             # 984.25 ft: terrain floor 2,000 ft
TOTAL_NM = geo.distance_nm(*START, *END)


def _dof_line(lat: float, lon: float, amsl_ft: int, agl_ft: int = 400) -> str:
    """One fixed-column DOF.DAT record at (lat, lon)."""
    def dms(value: float) -> tuple[str, str, str]:
        value = abs(value)
        deg, rem = int(value), (abs(value) - int(value)) * 60
        return str(deg), f"{int(rem):02d}", f"{(rem - int(rem)) * 60:05.2f}"

    lat_d, lat_m, lat_s = dms(lat)
    lon_d, lon_m, lon_s = dms(lon)
    line = [" "] * 130
    fields = {
        "city": "SOMEWHERE",
        "lat_deg": lat_d.rjust(2, "0"), "lat_min": lat_m, "lat_sec": lat_s, "lat_hem": "N",
        "lon_deg": lon_d.rjust(3, "0"), "lon_min": lon_m, "lon_sec": lon_s, "lon_hem": "W",
        "type": "TOWER", "agl": f"{agl_ft:05d}", "amsl": f"{amsl_ft:05d}", "lt": "R",
    }
    for name, text in fields.items():
        start, end = faa_data._DOF_COLUMNS[name]
        line[start:end] = list(text[: end - start].ljust(end - start))
    return "".join(line) + "\n"


@pytest.fixture
def ground(tmp_path, monkeypatch):
    """Flat ground everywhere, and whatever obstacles a test writes."""
    monkeypatch.setattr(elevation, "get_elevations_m", lambda points: {p: GROUND_M for p in points})
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})
    dof = tmp_path / "DOF.DAT"

    def obstacles(*lines: str):
        dof.write_text("".join(lines), encoding="latin-1")
        monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: dof, raising=False)
        monkeypatch.setattr(faa_data, "ensure_nasr_data", lambda cache_dir: (None, None, dof))
        return dof

    return obstacles


def _at(along_nm: float, cross_nm: float = 0.0) -> tuple[float, float]:
    """A point `along_nm` down the route and `cross_nm` to its left."""
    lat, lon = geo.destination_point(*START, 90.0, along_nm)
    if cross_nm:
        lat, lon = geo.destination_point(lat, lon, 0.0, cross_nm)
    return lat, lon


def _floors(*args, **kwargs) -> list:
    return [segment.floor_ft for segment in terrain.floor_profile(*args, **kwargs)]


def test_flat_ground_is_the_terrain_margin_rounded_up(ground, tmp_path):
    # 1,000 ft over the ground (14 CFR 91.119 over a town, which nothing
    # here can tell from a field), where the chart's MEF margin is 300:
    # the floor was only 300 ft over the highest ground.
    ground()
    (segment,) = terrain.floor_profile(START, END, [0.0, TOTAL_NM], faa_cache_dir=tmp_path)
    assert segment.floor_ft == 2000
    assert segment.lowest_ground_ft == pytest.approx(GROUND_M * terrain.M_TO_FT)


def test_an_obstacle_at_a_break_counts_for_both_legs(ground, tmp_path):
    ground(_dof_line(*_at(20.0), amsl_ft=2350))
    assert _floors(START, END, [0.0, 20.0, TOTAL_NM], faa_cache_dir=tmp_path) == [2500, 2500]


def test_an_obstacle_counts_up_to_the_half_width_beyond_a_leg(ground, tmp_path):
    ground(_dof_line(*_at(34.0), amsl_ft=2350))
    # 4 nm past the first leg's end: within the 5 nm half-width, so both.
    assert _floors(START, END, [0.0, 30.0, TOTAL_NM], faa_cache_dir=tmp_path) == [2500, 2500]
    # Well down the second leg: the first leg does not see it.
    assert _floors(START, END, [0.0, 10.0, TOTAL_NM], faa_cache_dir=tmp_path) == [2000, 2500]


def test_an_obstacle_beyond_the_corridor_is_ignored(ground, tmp_path):
    ground(_dof_line(*_at(20.0, cross_nm=6.0), amsl_ft=3350), _dof_line(*_at(25.0, cross_nm=4.0), amsl_ft=2150))
    assert _floors(START, END, [0.0, TOTAL_NM], faa_cache_dir=tmp_path) == [2300]


def test_an_obstacle_just_behind_the_start_counts_for_the_first_leg(ground, tmp_path):
    ground(_dof_line(*_at(-3.0), amsl_ft=2350))
    assert _floors(START, END, [0.0, 20.0, TOTAL_NM], faa_cache_dir=tmp_path) == [2500, 2000]


def test_min_safe_altitude_is_the_highest_floor(ground, tmp_path):
    ground(_dof_line(*_at(20.0), amsl_ft=2350))
    assert terrain.min_safe_altitude_msl(START, END, faa_cache_dir=tmp_path) == 2500


def test_two_reads_of_the_same_ground_at_once_ask_usgs_once(monkeypatch):
    """The planner reads a route's ground ahead (app.prefetch) and its
    altitude selection may ask while that is still going: the second
    waits for the first and is answered from the cache it filled."""
    import threading

    started, release = threading.Event(), threading.Event()
    fetched = []
    cache: dict = {}

    def get_elevations_m(points):
        missing = [p for p in points if p not in cache]
        if missing:
            fetched.append(len(missing))
            started.set()
            release.wait(5)
            cache.update({p: GROUND_M for p in missing})
        return {p: cache[p] for p in points}

    monkeypatch.setattr(elevation, "get_elevations_m", get_elevations_m)
    points = [START, END]
    results = []
    first = threading.Thread(target=lambda: results.append(terrain._elevations_m(points)))
    first.start()
    assert started.wait(5)
    second = threading.Thread(target=lambda: results.append(terrain._elevations_m(points)))
    second.start()
    release.set()
    first.join(5)
    second.join(5)
    assert fetched == [2]
    assert results == [{START: GROUND_M, END: GROUND_M}] * 2
