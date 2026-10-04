# syntax=docker/dockerfile:1
# The dependencies are installed before app/ is copied, so a change to
# the service's code rebuilds only the small layers after `COPY app`.

FROM python:3.13-slim
WORKDIR /service
RUN useradd -m appuser
COPY requirements.txt .
# --mount=type=cache: pip's own wheel/download cache, keyed by this
# image -- survives across local builds so a changed list doesn't
# re-download every wheel. The installed packages themselves are in the
# layer, which is what a CI runner restores from the registry cache.
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
COPY app ./app
# The build fails here if a package this image's code imports is
# missing, rather than the container on its next start: on 2026-09-22 a
# new import in vfr left both agents and both pipeline stages unable to
# start, and every build passed.
RUN python -B -c "import app.main"
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
