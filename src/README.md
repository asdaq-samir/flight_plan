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
  sh -c "pip install -q -r requirements-dev.txt && ruff check src/vfr tests && pytest tests/ -q"
```

The pipeline images deliberately carry no test tooling — they mirror what
a SageMaker Processing or Training job needs and nothing more — so tests
run in a plain `python:3.13-slim` against `requirements-dev.txt`.

Keep that file in step with `tests/`. A test module importing something
missing from it fails at *collection*, which takes the whole suite down
rather than one test.

There is no `pip install -e .`. Containers put `src/` on `PYTHONPATH`
directly (`ENV PYTHONPATH=/workspace/src`), so `import vfr` resolves
without packaging. That is a deliberate simplification for a repo where
every consumer is a container in the same tree — a library published to
an index would need a real `pyproject.toml`.

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
| `geo.py` | Great-circle distance, bearing, cross/along-track. Spherical Earth. |
| `navlog.py` | Wind correction angle, heading, ground speed, ETE, fuel. |
| `magnetic.py` | Magnetic variation, for true → magnetic. |
| `aircraft.py` | Performance profiles (a C172, by default). |

**Reading the world** — each wraps one external source.

| Module | Source |
|---|---|
| `chartvision.py` | FAA VFR sectional raster tiles, read by colour. The largest module here. |
| `osm.py` | Overpass API, for candidate landmarks. |
| `faa_data.py` | NASR airports/navaids and the Digital Obstacle File. |
| `weather.py` | Live winds aloft and hazards. |
| `airspace.py` | FAA Class B/C/D shapefiles, parsed once per 28-day cycle into a WKB cache beside them. |
| `elevation.py` | USGS 3DEP point elevations. |
| `terrain.py` | Terrain and obstacle floor for a route. |
| `airports.py` | Identifier → coordinates, and the route form's search. |
| `model_client.py` | model-service's `/invocations`, or the SageMaker endpoint on AWS. The one client every service scores through. |

**Deciding things**

| Module | What it decides |
|---|---|
| `altitude.py` | The VFR cruising altitude to file. |
| `checkpoints.py` | Which scored candidates actually become checkpoints. |
| `checkpoint_notes.py` | A pilot's own "how to spot it" note per checkpoint, kept apart from the training labels. |

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
