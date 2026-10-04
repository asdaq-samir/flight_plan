# model-service/

Serves the chart model, and nothing else. It loads the promoted
`model.joblib` and answers two endpoints. It knows no aviation — it takes
feature rows and returns scores.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [Things that are not obvious](#things-that-are-not-obvious)

## Running it

```bash
docker compose up -d model-service
# http://localhost:8000/docs
curl localhost:8000/ping
```

`data/models/chart/current` is mounted read-only at `/opt/ml/chart-model`.
Without a promoted model the service is still up: `/ping` says
`"chart_model": false`, `/score-detections` answers 503, and the planner
ranks the chart's detections by the palette's constants until a retrain
promotes one.

| Endpoint | What it does |
|---|---|
| `GET /ping` | Up, whether a chart model is promoted, and when it was trained. |
| `POST /score-detections` | The chart model's score for each detection row the planner sends, in order. |

## Learning this from zero

Start with the endpoint the planner calls and a model you fake:

```python
from fastapi import FastAPI

app = FastAPI()

@app.post("/score-detections")
def score_detections(payload: dict) -> dict:
    return {"scores": [3.0 for _ in payload["rows"]]}
```

It is wrong, but the planner can be built against it — getting the
*contract* right before the model is real is the sequence that saves
time.

### The rungs

1. **Answer with constants** (above). Now `planning-service` can be built
   against it.

2. **Type the payload.** Move `dict` to Pydantic models in
   `app/schemas.py`. A malformed request now fails at the boundary with a
   422 rather than somewhere inside your scoring code.

3. **Load a real artifact.** `joblib.load(CHART_MODEL_DIR / "model.joblib")`.
   Then discover that the file may be absent, and decide what to answer
   when it is: here a 503 that says how to get one, never a constant that
   looks like a score.

4. **Pin your dependencies.** A joblib file is a pickle of scikit-learn's
   own objects. Load it with a different sklearn and you get an
   `InconsistentVersionWarning`, then eventually a model that will not
   unpickle or, worse, silently mispredicts. This is the one place in the
   repo where versions are pinned hard.

### The method

Write the interface first and fill in the implementation second,
especially when something downstream is waiting. A stub with the right
shape unblocks the planner; a perfect model behind the wrong interface
unblocks nobody.

## Things that are not obvious

**The model's own libraries are pinned here and nowhere else.**
`docker/requirements-training.txt` deliberately leaves scikit-learn and
joblib unpinned (numpy and pandas come pinned from vfr's own list,
`src/requirements.txt`, at the same versions as here);
`model-service/requirements.txt` is pinned to what training currently
resolves to. The asymmetry is the point — the serving image must not
drift ahead of the artifact it loads. **Bump both together.**

**The model is read again when a promotion rewrites it.** A retrain
promotes into the mounted directory while the service runs. Each request
compares the files' size and modification time with what was loaded, so
the next score comes from the new model without a restart, and an
unchanged model is never unpickled twice.

**The columns come from the model, not the request.** The rows are
reindexed to the `feature_cols` in the model's own `metrics.json`: a
retrain that adds or drops a feature changes what is scored without a
change here, and a feature the planner did not send reads as 0.
