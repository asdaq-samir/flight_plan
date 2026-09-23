# src/

`vfr` — the domain library. Every aviation fact this project knows lives
here: great-circle geometry, dead reckoning, airspace, terrain, weather,
and reading checkpoints off a raster sectional chart.

Nothing here serves HTTP, and nothing here imports a web framework.
`planning-service`, the pipeline containers, Airflow and both Gen AI
agents are all callers. That separation is the point — the same
`navlog.py` runs inside a FastAPI request, a notebook cell, an Airflow
task and a LangGraph tool, unchanged.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [The module map](#the-module-map)
- [Things that are not obvious](#things-that-are-not-obvious)

## Running it

```bash
# The test suite and the linter, exactly what CI runs
docker run --rm -v "$PWD":/w -w /w -e PYTHONPATH=/w/src python:3.13-slim \
  sh -c "apt-get update -qq && apt-get install -y -qq libexpat1 && pip install -q -r requirements-dev.txt && ruff check src/vfr tests && pytest tests/ -q"
```

The pipeline images deliberately carry no test tooling — they mirror what
a SageMaker Processing or Training job needs and nothing more — so tests
run in a plain `python:3.13-slim` against `requirements-dev.txt`, plus
the one system library (`libexpat1`) rasterio's wheel expects and the
slim image leaves out -- without it `tests/test_charts.py` fails to import.

There is no `pip install -e .`. Containers put `src/` on `PYTHONPATH`
directly (`ENV PYTHONPATH=/workspace/src`), so `import vfr` resolves
without packaging. That is a deliberate simplification for a repo where
every consumer is a container in the same tree — a library published to
an index would need a real `pyproject.toml`.

What packaging would have given for free is one list of the package's
own dependencies, so that list lives here instead:
`src/requirements.txt`, pinned once, and `src/requirements-charts.txt`
on top of it for `vfr.charts`/`vfr.chartvision`'s raster stack. Every
image that runs vfr -- planning-service, the two pipeline stages, `ml`
-- and `requirements-dev.txt` include one of them with a `-r` line and
list only what they need beyond it. **A new third-party import in
`src/vfr` is one line in one of those two files.** Before, it was a line
in six, and on 2026-09-22 a missed one left both agents and both
pipeline stages unable to import. CI's build job now imports each
service's own code inside its built image, so a miss fails there. The
two agents import only `vfr.planner_client`, which needs `requests`
alone, and install neither list.

## Learning this from zero

The bare minimum is one file and no dependencies:

```python
# geo.py
import math

def distance_nm(lat1, lon1, lat2, lon2):
    """Great-circle distance, spherical Earth."""
    R_NM = 3440.065
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R_NM * 2 * math.asin(math.sqrt(a))
```

That is genuinely useful on its own — two airports in, a distance out —
and it needs nothing but the standard library. Everything else in this
package is built on it.

### The rungs

Each adds one dependency or one external source, and each answers a
question the previous rung raises.

1. **Distance and bearing** (`geo.py`, stdlib only). Write
   `distance_nm` and `initial_bearing_deg` and test them against a known
   pair. Now you can measure a leg.

2. **Where are the airports?** (`airports.py`, +pandas). A distance
   needs coordinates, and typing them by hand stops being funny quickly.
   Parse OurAirports' CSV and look up by identifier.

3. **How long will it take?** (`navlog.py`, stdlib). Distance over
   airspeed is a first answer, and it is wrong, because air moves. The
   wind triangle — wind correction angle, ground speed — is the whole
   content of this module and is pure trigonometry.

4. **Where does the wind come from?** (`weather.py`, +requests). Now you
   need live data, and with it caching, timeouts and the question of what
   to do when a station is missing. Note that no wind is not the same as
   no wind *data*: the nav-log table shades those rows for that reason.

5. **What altitude may I fly?** (`terrain.py`, `airspace.py`,
   `altitude.py`, +shapely +pyshp). The first real domain complexity:
   a terrain floor, an obstacle floor, a hemispherical rule, and Class B
   overhead. Reading the FAA's shapefiles is most of the work.

6. **Which landmarks are worth flying to?** Two answers, and the second
   exists because the first disappointed. `osm.py` + `features.py`
   query Overpass for candidate landmarks and build a model-ready table.
   `chartvision.py` instead reads the sectional raster and segments it by
   the chart's own colour palette — no outside data at all.

7. **Make it repeatable** (`pipeline.py`, `model_registry.py`). Wrap
   collect → engineer → retrain → evaluate → promote as callable
   functions, so a notebook, a container and a DAG all run the same code.

### The method

Start with the function that needs no data source. Add a source only when
hand-entering its data becomes the bottleneck. Every module here arrived
that way, and the order above is roughly the order they were written.

## The module map

Grouped by what they are for, not alphabetically.

**Geometry and dead reckoning** — pure functions, no I/O, fastest tests.

| Module | What it does |
|---|---|
| `geo.py` | Great-circle distance, bearing, cross/along-track, nearest-neighbour and clustering -- PROJ (`pyproj`) under a thin scalar/array-dispatching layer, not hand-rolled trigonometry. Every function takes a bare float or a whole array the same way. |
| `navlog.py` | Wind correction angle, heading, ground speed, ETE, fuel -- per leg, and the legs and totals of a whole route, shared by the planner and both agents. |
| `magnetic.py` | Magnetic variation, for true → magnetic (the World Magnetic Model, evaluated locally). |
| `sun.py` | Civil twilight, for the night fuel reserve. |
| `aircraft.py` | Performance profiles (a C172, by default), cached by resolved path -- see planning-service/README.md's own note on why a cached profile is handed out as a fresh copy, never the cached object itself. |

**Reading the world** — each wraps one external source.

| Module | Source |
|---|---|
| `chartvision.py` | FAA VFR sectional raster tiles, read by colour. The largest module here. |
| `charts.py` | The same FAA GeoTIFFs rendered as an XYZ tile pyramid -- sectionals, TACs, IFR enroute and IFR area charts -- with neatline detection so adjacent sheets butt together and no street map shows through the gaps, one drawing order for the pyramid and for tiles rendered on demand (they used to disagree inside sheet overlaps), and the sectional's masked lines -- the paper band round each TAC and inset -- taken back out when a sheet is prepared. `planning-service`'s `/api/chart-tile/*` and the batch `prepare`/`pyramid`/`refresh`/`unmask` commands (see that service's own README) are this module's CLI. |
| `osm.py` | Overpass API, for candidate landmarks. |
| `faa_data.py` | NASR airports/navaids and the Digital Obstacle File. |
| `weather.py` | Winds aloft (one small request), and METARs/TAFs/SIGMETs from aviationweather.gov's cache files -- the whole national dataset every five minutes, not a query per route. |
| `airspace.py` | FAA Class B/C/D shapefiles, parsed once per 28-day cycle into a WKB cache beside them. |
| `elevation.py` | USGS 3DEP point elevations. |
| `terrain.py` | Terrain and obstacle floor for a route. |
| `airports.py` | Identifier → coordinates, and the route form's search. |
| `model_client.py` | model-service's `/invocations`, or the SageMaker endpoint on AWS. The one client planning-service scores through -- a persistent `requests.Session` and a lazily-built, reused `boto3` SageMaker client, not one connection or one client per call. |
| `planner_client.py` | planning-service's `/api/plan`, `/api/checkpoints` and `/api/altitude-breakdown`, for the two agents: the nav log they brief is the planner's own, not one they assemble. `requests` only, so importing it pulls in none of this package's other dependencies. |
| `retry.py` | The one retry loop the four modules above share for their requests. |

**Deciding things**

| Module | What it decides |
|---|---|
| `altitude.py` | The VFR cruising altitude to file, and the reasoning behind it -- terrain floor, airspace ceiling, freezing level, current ceiling/visibility, hazards, timed per stage (see planning-service/README.md). |
| `checkpoints.py` | Which scored candidates actually become checkpoints. |
| `checkpoint_notes.py`, `routecsv.py` | A pilot's own "how to spot it" note per checkpoint, and the shared "one judgment at one place on one route" CSV mechanics (read-and-coerce, rewrite-whole-file, "same place" by proximity) it and `chartlabels.py` both need -- one module, so the two files' own same-distance threshold is one constant instead of two copies that could drift apart. |
| `classb.py` | Every Class B airport, matched from the FAA Class Airspace shapefile's ~370 polygons down to the ~30 airports they actually belong to -- envelope containment plus ident-prefix matching, not a bare ident lookup (a bare "HNL" once matched a Mexican airspace record). |

**The ML pipeline**

| Module | Role |
|---|---|
| `pipeline.py` | collect → engineer → retrain, callable and non-interactive. |
| `model_registry.py` | Evaluate a retrained model, promote it if better. |
| `model_candidates.py`, `torch_model.py` | The same regression in PyTorch, TensorFlow and Spark MLlib, each a re-runnable entry point that persists an artifact. |
| `chartlabels.py` | Checkpoints marked by hand on the chart. |
| `chartfeatures.py` | Features for a chart-vision scorer. |
| `chartlabels_join.py` | Bootstraps a training set by position. |
| `features.py` | Feature engineering for the tabular model. |
| `config.py` | Paths and thresholds, free of heavy imports. |

## Things that are not obvious

**`config.py` is deliberately import-light.** `pipeline.py` drags in
requests, pyarrow and the OSM/FAA modules just by being imported. A
consumer that only needs to know *where* the data lives would pay for all
of it, so the constants live in their own module that costs `pathlib` and
nothing else.

**The great circle is walked, not interpolated.** `geo.py` recomputes the
bearing toward the destination at every step. Hold the initial bearing
constant instead and you trace a rhumb line, which sits a couple of miles
off true course at the midpoint of a 300 nm leg. An early chart-vision
crossing detector interpolated in pixel space and found 1 of 34 known
crossings; walking the real great circle found 24.

**`chartfeatures.py` is plumbing, not a shipped model.** Its docstring
records the measurement: on the 77 bootstrap labels available, no model
beat predicting the mean, and the hand-set palette constants were already
level with it. The blocker is label spread — 79% of labels are 4 or 5 —
not the features.

**Route position was removed from the feature set on purpose.** Measured
over 25-fold repeated CV, a model given *only* where a point sat along
the route recovered 78% of the full model's gain. That is a route being
memorised rather than spottability being learned.

**`geo.py` is PROJ, not `pygeodesy`, and the difference was measured,
not assumed.** A `pygeodesy`-based rewrite once cost 50x on every
call -- 86% of it was constructing `pygeodesy.LatLon` objects, not the
geodesic maths itself, and its plain-function form was no faster.
`pyproj`'s own `Geod`, configured as a sphere sized in nautical miles,
answers in 0.87 µs/point vectorised against `pygeodesy`'s 80 µs;
`pygeodesy` is a **test dependency only** now (`requirements-dev.txt`),
kept as the independent oracle `tests/test_geo.py` pins this module
against, never a service dependency again. The lesson generalises past
this one module: a library swap made for its own sake, without timing
the hot path first, is exactly how this regression happened the first
time.
