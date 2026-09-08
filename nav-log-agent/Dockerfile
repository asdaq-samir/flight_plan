FROM python:3.12-slim

WORKDIR /workspace/nav-log-agent

COPY nav-log-agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV PYTHONPATH=/workspace/src
ENTRYPOINT ["python3", "-m", "app.main"]
