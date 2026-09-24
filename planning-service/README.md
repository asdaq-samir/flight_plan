# planning-service/

The aviation work, over HTTP. Reads FAA sectional tiles, walks great
circles, selects checkpoints and computes the dead-reckoning nav log.

It serves no pages. The front end is in [`web/`](../web) and ships inside
`webapp`'s jar; the browser reaches this service only through `webapp`'s
`/api/planner/*` proxy. On AWS it has no load-balancer route at all.

Almost all of the thinking lives in [`src/vfr`](../src). This is a thin
HTTP layer over it: `app/main.py` builds the app, `app/routers/` holds
the endpoints one module per concern (plan, chart, build, briefing,
notes, devml), and the work they share -- resolving a route
(`common.py`), scoring and selecting its checkpoints (`scoring.py`), the
cruise altitude and course line (`planning.py`), the corridor read
(`detection.py`) -- sits beside them. The legs themselves are
`vfr.navlog`'s, the same code both agents build theirs with.
Every response, streamed lines included, is a model in `app/schemas.py`:
FastAPI validates against it and publishes it in `openapi.json`,
committed here and checked by `tests/test_openapi.py`. After changing a
model, run `python -m app.openapi` and commit the result; `web/`
generates its TypeScript types from that file. The three NDJSON streams
always end with a `done` or an `error` line: a failure after the first
line is out cannot change the status any more, so it is reported as the
last line rather than as a truncated body.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [The endpoints](#the-endpoints)
- [Things that are not obvious](#things-that-are-not-obvious)

## Running it

```bash
docker compose up -d planning-service
# http://localhost:8084/docs   <- FastAPI's generated API page
```

Port 8084 is for debugging only; nothing in the front end uses it. The
real path is `http://localhost:8080/api/planner/*` through `webapp`.

## Learning this from zero

FastAPI's minimum is genuinely two files, and one of them is a
dependency list:

```python
# app/main.py
from fastapi import FastAPI

app = FastAPI()

@app.get("/api/course")
def course(dep: str, dest: str) -> dict:
    return {"departure": dep, "destination": dest, "distance_nm": 0.0}
```

```bash
pip install fastapi "uvicorn[standard]"
uvicorn app.main:app --reload
```

You now have a JSON API *and* an interactive documentation page at
`/docs`, generated from the type hints. That generation is the reason to
choose FastAPI over Flask here: `dep: str` is simultaneously validation,
documentation and an editor hint.

### The rungs

1. **Return a constant** (above). Learn that the annotations are load
   bearing: change `dep: str` to `dep: int` and send a word, and you get
   a 422 with a useful message you did not write.

2. **Call your own library.** `from vfr import geo` and return a real
   distance. Nothing about the web layer changes — which is the point of
   keeping the domain code in `src/`.

3. **Make a slow endpoint fast enough to use.** Reading a corridor's
   tiles takes seconds. First make it work, then notice the page sits
   blank while it does. Splitting `/api/course` (sub-second) from
   `/api/checkpoints` from `/api/navlog` is the fix, and it is a design
   decision, not an optimisation.

4. **Stream the slow one.** `/api/detect/stream` returns
   newline-delimited JSON from a `StreamingResponse`, so detections
   appear block by block from the departure end. The client side is an
   async generator in `web/src/lib/api/client.ts`.

5. **Handle work too slow for a request.** Collecting an uncollected
   corridor is minutes of Overpass and FAA calls. A request held open
   that long dies in any proxy, so `/api/build` starts a background
   thread and returns a job id to poll.

6. **Cache what you re-read.** A first version re-parsed the national
   airports CSV on every request — 2.1 s, which was the entire
   time-to-first-marker. Module-level caches took a plan from 51 s to
   13.7 s. Measure before and after; the number is the lesson.

### The method

Write the endpoint against a constant, then swap the constant for a real
call. If the real call is slow, the fix is usually *splitting the
endpoint*, not speeding up the function — a pilot would rather see the
course line immediately and the nav log in ten seconds than everything at
once in ten.

## The endpoints

| Path | What it does |
|---|---|
| `GET /` | Says the service is up and where the UI went. |
| `GET /api/course` | The leg itself. Sub-second, so the map draws immediately. |
| `GET /api/checkpoints` | Scored candidates and the subset worth flying. |
| `GET /api/navlog` | The three altitude plans (lowest, highest, fastest for the winds, each stepping under a Class B shelf and up past it), the one chosen (`altitude_choice`), and the dead-reckoning legs, streamed as NDJSON. `depart`, an ISO time, picks the winds forecast period (6, 12 or 24 hours out) and whether the fuel reserve is the day or the night one; the totals carry the fuel check against the aeroplane's usable fuel (`usable_fuel_gal` overrides the profile's). Each leg carries its climb -- from the field on the first, up to a new level where a plan steps -- at the profile's climb rate, speed and burn. The slow one. |
| `GET /api/plan` | All three at once, for non-browser callers. |
| `GET /api/briefing` | The FAA-sequence weather briefing behind Plan's briefing (the nav log drawer opened wide). |
| `GET /api/altitude-breakdown` | The reasoning behind a recommended cruise altitude. |
| `GET /api/detect/stream` | Chart-vision detections, streamed as NDJSON. |
| `GET /api/classify` | What the chart draws at one point. |
| `GET /api/sectional-tile/{z}/{x}/{y}.png` | The sectional as a tile pyramid, for the map -- rendered from the FAA's own GeoTIFF of each sheet (`vfr.charts`), collar clipped away so sheets butt together. Zooms 3-12: the whole country on a phone screen, down to the chart's own print resolution. |
| `GET /api/tac-tile/{z}/{x}/{y}.png` | The terminal area charts the same way, for the map's optional overlay; 404 wherever no TAC exists. Zooms 10-13. |
| `GET /api/chart-tile/{kind}/{z}/{x}/{y}.png` | Any chart kind by key -- `sec`, `tac`, `ifr_low`, `ifr_high` (the IFR enroute charts, base layers the map's info popover can switch to), `ifr_area` (the enroute charts' terminal-area sheets, an overlay over the IFR bases the way the TAC is over the sectional). `chart_layers` on the course lists the kinds, their zooms and which base each overlay belongs over. On AWS the course also carries `chart_tiles_base`, the CloudFront URL the browser fetches tiles from instead (docs/README-AWS.md). |
| `GET /api/class-b` | Every Class B airport: where it is, what its METAR/TAF are doing now and forecast, and which terminal area chart covers it. One call for all thirty rather than one per marker -- the airspace shapefile is parsed once and pickled (`vfr.classb`, `data/raw/faa_nasr/Shape_Files/Class_Airspace.controlled.v2.pkl`), and the METAR/TAF national caches are already held in memory by `vfr.weather`, so assembling all thirty costs about as much as assembling one. |
| `GET/POST/DELETE /api/picks` | Hand-marked checkpoints. |
| `GET/POST /api/checkpoint-notes` | A pilot's "how to spot it" note per checkpoint. |
| `GET /api/airports/search` | Identifier and name lookup for the route form. |
| `POST /api/build`, `GET /api/build/{id}` | Start and poll a corridor collection. |
| `GET /api/routes` | Corridors the feature store already covers. |
| `GET /api/model-comparison` | Every trained algorithm's accuracy side by side, and which one is promoted. |
| `GET /api/aircraft-profiles` | The stock performance profiles the nav log can be computed for. `/api/plan` and `/api/navlog` take `aircraft` plus optional `cruise_tas_kt`/`fuel_burn_gph` for a pilot's own aeroplane. |
| `GET /api/status` | The whole stack in one snapshot for the dev console: which services answer, how fresh the FAA and weather data is, the model registry, and every collected corridor with its label counts. |
| `POST /api/retrain` | One run of the training DAG through Airflow, or a 501 that says how to run it by hand. |
| `GET /api/dev/services`, `POST /api/dev/services/{service}/start` | Whether `ml`, `airflow`, `model-service` and `nav-log-agent` are running, and starting one that isn't -- what the dev console's System tab links to. Asks the `dev-services` sidecar (`docker/dev-services`), which holds the Docker socket and answers only these two requests for these four names in this compose project; this service never touches Docker itself. The sidecar is on a network only planning-service shares, so nothing else in the stack can reach it, and it 404s on any other name. |

The tile endpoints render on first request and cache on disk, which is
fine for one corridor and not for a map with no street layer under it.
For the whole country ahead of time (the sectional is the map's only
base layer, so this is the normal state of a running stack):

```sh
docker compose run --rm --no-deps planning-service python -m vfr.charts prepare   # every sheet: sectionals (the lower 48, Alaska, Hawaii, the Caribbean), TACs, IFR low and high; ~7 GB
docker compose run --rm --no-deps planning-service python -m vfr.charts pyramid   # every tile of every kind; about two hours with --workers 3
```

`run --rm`, not `exec`: a render inside the serving planner's own
container has had it killed for memory twice.

Both resume where they stopped. The sheets land in
`data/raw/charts.nosync/<cycle>/`, the tiles in
`data/raw/chart_tiles.nosync/<cycle>/` (the suffix keeps iCloud Drive
from syncing them; elsewhere it is just a name). The Dev console's
System tab shows the sheets prepared and the pyramid's progress.

The planner keeps up with the 56-day cycle by itself: at start-up and
once an hour it asks the FAA's products page which cycle is current
and, if that cycle's pyramid is not complete on disk, runs `python -m
vfr.charts refresh` in a subprocess (prepare, render, then delete the
previous cycle). The map switches to the new cycle only once every
tile of it is there, so a refresh in progress changes nothing on
screen. The render is hours of every core it is given, so it starts
only inside `CHARTS_REFRESH_WINDOW` (`HH:MM-HH:MM` on the container's
clock, `01:00-06:00` by default, blank for any time; set `TZ` for a
local clock), niced, with `CHARTS_REFRESH_WORKERS` processes (one by
default) -- unless nothing complete is on disk at all, when it starts
at once. `refresh now` in the Dev console starts one at once with two
workers, and `CHARTS_AUTO_REFRESH=0` turns the check off. All of that
policy -- the window, the due check, the worker counts -- is
`app/chart_refresh.py`; `vfr.charts` does the work it asks for. `python -m
vfr.charts check` looks for daylight between adjacent sheets, which is
what a mis-detected sheet edge would show up as; the one it always
reports, between the Caribbean 1 chart and Jacksonville west of 83W,
is the open Gulf, where the FAA charts no sectional.

Preparing a sectional also takes its masked lines out: the paper band
the FAA prints round every TAC's coverage and round its own insets,
which on this map -- where the TAC is a layer of its own -- read as a
white box round every Class B whether the TAC was drawn or not. Only
the band's paper changes, to the tint either side of it; everything
printed over it, the "TAC" lettering included, stays
(`vfr.chart_faces.remove_masked_lines` says how a band is told from a label
box or a dry lake). Sheets prepared before that step existed are
cleaned, and their tiles rendered again, by

```sh
docker compose run --rm -T --no-deps planning-service python -m vfr.charts unmask --workers 2   # half an hour; re-runnable
```

which also bumps the cycle's tile revision (`chart_revision` on the
course), since a browser's service worker holds tiles for weeks under a
URL a re-render would not otherwise change. `unmask --again` looks once
more at sheets already cleaned, along the borders of what was taken out
of them -- for after the search learns to find more. To put a sheet back as the
FAA printed it, delete its folder under `data/raw/charts.nosync/` and
`prepare` downloads it again.

## Things that are not obvious

**scikit-learn is deliberately absent.** This service builds a feature
parquet and asks `model-service` to score it. Installing sklearn here
would create a second, unpinned place a model could be loaded from — and
a joblib artifact is a pickle of sklearn's own objects, so the version
that loads it must match the version that wrote it.

**Collection runs in-process, not as a container.** `/api/build` starts a
thread rather than launching a pipeline container, because handing this
service the Docker socket is a far larger grant than it needs.

**Build state is in memory on purpose.** A restart forgets a
half-finished job rather than resuming something whose partial output is
already on disk.

**It writes into the shared data volume.** A new corridor's candidates
and features land in `data/processed`, the same directory `model-service`
reads feature stores from. On AWS that becomes the S3 bucket the pipeline
jobs use — and **the Python does not read `VFR_DATA_S3_BUCKET` yet**, so
a Fargate task would start and then fail to find FAA data. That is the
one piece of the AWS path still unfinished.

**A cache hit and two concurrent misses are different problems, and
this service's caches (`app/planning.py`'s `SingleFlightTTLCache`, in
front of the cruise-altitude selection and the three altitude plans)
solve both.** The obvious version -- lock, check the dict, unlock,
compute on a miss, lock again to store it -- only ever protects the
dict. It leaves the computation itself unguarded, so two requests for
the same not-yet-cached route (the same plan open in two tabs, a
client's own retry racing the request it gave up on) both pay for the
whole terrain/airspace/weather stack, which the comment beside that
cache already measured at over two minutes on a bad
aviationweather.gov day. A miss now registers itself with a
`threading.Event`; a second caller for the *same* key waits on that
event instead of repeating the work, a different key still computes in
parallel (one lock per cache, not one lock held for the duration of a
computation), and a failed compute does not poison whoever was
waiting on it -- they get their own attempt instead of the leader's
exception.

**Nothing was watching how long any of this actually took, and the gap
was invisible until something went looking.** `vfr.altitude.
select_cruise_altitude` times each of its seven concurrent calls
(terrain, both airspace queries, transits, magnetic variation, and the
three weather calls) plus its own total; `vfr.model_client.invoke`
times the call to `model-service` or SageMaker; this router's own
`/api/class-b` times the airspace read and the weather lookup
separately. All three were added, run against the built container, and
found to produce *no output at all* -- Python's root logger defaults
to `WARNING`, uvicorn's own `--log-level` only reaches its own
`uvicorn.access`/`uvicorn.error` loggers, and nothing in this process
had ever called `logging.basicConfig`. Every `log.info()` already
written elsewhere in this codebase (`vfr.weather`, `vfr.charts`, both
older than the timing lines) had been going nowhere since it was
written. `app/main.py` now calls `logging.basicConfig(level=os.environ
.get("LOG_LEVEL", "INFO"))` once, at import time, which is what makes
all of it -- old and new -- actually appear.

**A pilot's own aeroplane numbers must never overwrite the stock
profile.** `vfr.aircraft.load_aircraft_profile` is `lru_cache`d (it
used to reopen and reparse the same JSON file on every plan and
altitude request), and `planning.py`'s `aircraft_profile()` writes a
pilot's `cruise_tas_kt`/`fuel_burn_gph`/`usable_fuel_gal` overrides
onto the dict it gets back, **in place**. Caching the parsed dict
itself would have hit both of those in the same call: the second
pilot to plan in "c172" with no override of their own would have
gotten the first pilot's aeroplane. The cache holds the parse; every
call gets a fresh shallow copy.
