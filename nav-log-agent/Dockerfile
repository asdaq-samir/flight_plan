# syntax=docker/dockerfile:1
FROM python:3.13-slim

WORKDIR /workspace/nav-log-agent

COPY nav-log-agent/requirements.txt .
# sentence-transformers pulls torch, and the default torch wheel brings
# several GB of CUDA/cuDNN with it -- 3.2 GB of nvidia/ plus a 1.2 GB
# torch in an image that runs on a laptop and deploys to Fargate, neither
# of which has a GPU. Installing the CPU wheel first means the dependency
# is already satisfied when sentence-transformers asks for it.
# docker/Dockerfile.ml does the same thing for the same reason.
RUN --mount=type=cache,target=/root/.cache/pip pip install torch --index-url https://download.pytorch.org/whl/cpu
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY nav-log-agent/app ./app
COPY src /workspace/src

RUN useradd -m appuser
USER appuser

ENV PYTHONPATH=/workspace/src
ENTRYPOINT ["python3", "-m", "app.main"]
