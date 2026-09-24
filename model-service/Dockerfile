# syntax=docker/dockerfile:1
FROM python:3.13-slim

WORKDIR /service

COPY requirements.txt .
# --mount=type=cache: pip's own wheel/download cache, keyed by this
# image -- survives across builds so an unrelated app/ change doesn't
# force re-downloading the same wheels (torch/tensorflow chief among
# them; see docker/tidy.sh's own comments on how expensive that is).
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY app ./app
# The build fails here if a package this image's code imports is
# missing, rather than the container on its next start: on 2026-09-22 a
# new import in vfr left both agents and both pipeline stages unable to
# start, and every build passed. The lazy imports are named too, as
# importing the entry module does not reach them.
RUN python -B -c "import app.main, torch, tensorflow"

RUN useradd -m appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
