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
| `GET /api/navlog` | The three altitude plans (lowest, highest, fastest for the winds, each stepping under a Class B shelf and up past it), the one chosen (`altitude_choice`), and the dead-reckoning legs, streamed as NDJSON. The slow one. |
| `GET /api/plan` | All three at once, for non-browser callers. |
| `GET /api/briefing` | The FAA-sequence weather briefing behind Plan's briefing (the nav log drawer opened wide). |
| `GET /api/altitude-breakdown` | The reasoning behind a recommended cruise altitude. |
| `GET /api/detect/stream` | Chart-vision detections, streamed as NDJSON. |
| `GET /api/classify` | What the chart draws at one point. |
| `GET /api/sectional-tile/{z}/{x}/{y}.png` | The sectional as a cached tile pyramid, for the map. |
| `GET/POST/DELETE /api/picks` | Hand-marked checkpoints. |
| `GET/POST /api/checkpoint-notes` | A pilot's "how to spot it" note per checkpoint. |
| `GET /api/airports/search` | Identifier and name lookup for the route form. |
| `POST /api/build`, `GET /api/build/{id}` | Start and poll a corridor collection. |
| `GET /api/routes` | Corridors the feature store already covers. |
| `GET /api/model-comparison` | Every trained algorithm's accuracy side by side, and which one is promoted. |
| `GET /api/aircraft-profiles` | The stock performance profiles the nav log can be computed for. `/api/plan` and `/api/navlog` take `aircraft` plus optional `cruise_tas_kt`/`fuel_burn_gph` for a pilot's own aeroplane. |
| `GET /api/status` | The whole stack in one snapshot for the dev console: which services answer, how fresh the FAA and weather data is, the model registry, and every collected corridor with its label counts. |
| `POST /api/retrain` | One run of the training DAG through Airflow, or a 501 that says how to run it by hand. |

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
