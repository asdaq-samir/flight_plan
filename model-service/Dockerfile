# syntax=docker/dockerfile:1
FROM python:3.14-slim

WORKDIR /service

COPY requirements.txt .
# --mount=type=cache: pip's own wheel/download cache, keyed by this
# image -- survives across builds so an unrelated app/ change doesn't
# force re-downloading the same wheels (torch/tensorflow chief among
# them; see docker/tidy.sh's own comments on how expensive that is).
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY app ./app

RUN useradd -m appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
