FROM python:3.12-slim

WORKDIR /workspace/crewai-agent

COPY crewai-agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV PYTHONPATH=/workspace/src
ENTRYPOINT ["python3", "-m", "app.main"]
