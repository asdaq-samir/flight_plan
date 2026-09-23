# model-service/

Serves the trained model, and nothing else. It loads `model.joblib` and
answers three endpoints. It knows no aviation — it takes feature rows and
returns scores.

The shape is not arbitrary: `/ping` and `/invocations` are **SageMaker's
serving-container contract**, so the same image runs under `docker
compose` locally and as a SageMaker real-time endpoint on AWS with no
code change. That single decision is why this service looks the way it
does.

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

It needs a promoted model. `data/models/current` is mounted read-only at
`/opt/ml/model` — SageMaker's own path — and the service will report
itself unhealthy without one.

## Learning this from zero

Start with the two endpoints AWS requires and a model you fake:

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/ping")
def ping() -> dict:
    return {"status": "healthy"}

@app.post("/invocations")
def invocations(payload: dict) -> dict:
    return {"scores": [4.0 for _ in payload["rows"]]}
```

That is a valid SageMaker serving container. It is wrong, but it is
deployable, and getting the *contract* right before the model is real is
the sequence that saves time — this service returned a hand-written stub
for weeks while the rest of the pipeline was built around it.

### The rungs

1. **Answer `/ping` and `/invocations` with constants** (above). Now
   `webapp` and `planning-service` can be built against it.

2. **Type the payload.** Move `dict` to Pydantic models in
   `app/schemas.py`. A malformed request now fails at the boundary with a
   422 rather than somewhere inside your scoring code.

3. **Load a real artifact.** `joblib.load(MODEL_DIR / "model.joblib")`,
   at startup rather than per request. Then discover that the file may be
   absent, and decide what `/ping` should say when it is — a serving
   container that reports healthy without a model is worse than one that
   reports unhealthy.

4. **Pin your dependencies.** A joblib file is a pickle of scikit-learn's
   own objects. Load it with a different sklearn and you get an
   `InconsistentVersionWarning`, then eventually a model that will not
   unpickle or, worse, silently mispredicts. This is the one place in the
   repo where versions are pinned hard.

5. **Read from the path AWS will use.** `MODEL_DIR` defaults to
   `/opt/ml/model` because that is where SageMaker mounts a model
   artifact. Matching it locally means the AWS move needs no change.

### The method

Write the interface first and fill in the implementation second,
especially when something downstream is waiting. A stub with the right
shape unblocks two other services; a perfect model behind the wrong
interface unblocks nobody.

## Things that are not obvious

**`/ping` and `/invocations` are not names anyone chose.** They are
AWS's. A SageMaker inference container must answer `GET /ping` for health
and `POST /invocations` for inference. Renaming them to something tidier
would mean the image could no longer be deployed as-is.

**The model's own libraries are pinned here and nowhere else.**
`docker/requirements-training.txt` deliberately leaves scikit-learn and
joblib unpinned (numpy and pandas come pinned from vfr's own list,
`src/requirements.txt`, at the same versions as here);
`model-service/requirements.txt` is pinned to what training currently
resolves to. The asymmetry is the point — the serving image must not
drift ahead of the artifact it loads. **Bump both together.**

**`/routes` is a convenience, not part of the contract.** It lists the
feature stores under `/opt/ml/features`, so `planning-service` can offer
a datalist of corridors. It is the one endpoint here that would not exist
on SageMaker.

**The model is loaded once, at import.** Per-request loading would be
several hundred milliseconds of unpickling on every call.
