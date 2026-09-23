# syntax=docker/dockerfile:1
FROM python:3.13-slim

WORKDIR /workspace/crewai-agent

COPY crewai-agent/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY crewai-agent/app ./app
COPY src /workspace/src

RUN useradd -m appuser
USER appuser

ENV PYTHONPATH=/workspace/src
# The HTTP wrapper the webapp's flight planning drawer calls. The one-shot CLI is
# `python3 -m app.main ...`, passed as the command instead.
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000"]
