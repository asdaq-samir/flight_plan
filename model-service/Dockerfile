# syntax=docker/dockerfile:1
# Two images from one file. The last stage, the default, is the service
# as it ships: the scikit-learn serving stack, and torch and tensorflow
# for the framework candidates it can serve -- four of its five
# gigabytes. `slim` is the serving stack alone, for a scikit-learn model:
# CI's browser suite runs it (.github/ci-images.hcl), because loading the
# full image onto each of its runners was most of their setup. torch and
# tensorflow are imported only when a candidate of theirs is on disk
# (app/main.py), so the two serve a scikit-learn model the same way.
#
# The dependencies are installed before app/ is copied, each list in a
# layer of its own, so a change to the service's code rebuilds neither:
# only the two small layers after `COPY app` run again.

FROM python:3.13-slim AS serving
WORKDIR /service
RUN useradd -m appuser
COPY requirements-serving.txt .
# --mount=type=cache: pip's own wheel/download cache, keyed by this
# image -- survives across local builds so a changed list doesn't
# re-download every wheel. The installed packages themselves are in the
# layer, which is what a CI runner restores from the registry cache.
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements-serving.txt

FROM serving AS frameworks
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

FROM serving AS slim
COPY app ./app
RUN python -B -c "import app.main"
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM frameworks
COPY app ./app
# The build fails here if a package this image's code imports is
# missing, rather than the container on its next start: on 2026-09-22 a
# new import in vfr left both agents and both pipeline stages unable to
# start, and every build passed. The lazy imports are named too, as
# importing the entry module does not reach them.
RUN python -B -c "import app.main, torch, tensorflow"
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
