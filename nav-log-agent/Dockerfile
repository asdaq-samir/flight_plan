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

# The embedding model's weights, baked in at build time and read offline
# from then on. Without this the model was fetched on the first request
# after every image rebuild, and every process start made a round of
# huggingface.co HEAD requests before embedding anything -- a few seconds
# of a pilot's own wait for a narrative, and a hard dependency on that
# site being up. HF_HOME sits outside the bind-mounted /workspace so a
# local `docker compose up` sees the same baked weights as AWS does.
ENV HF_HOME=/opt/hf
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" \
    && chmod -R a+rX /opt/hf
ENV HF_HUB_OFFLINE=1

COPY nav-log-agent/app ./app
COPY src /workspace/src

RUN useradd -m appuser
USER appuser

ENV PYTHONPATH=/workspace/src
# The build fails here if a package this image's code imports is
# missing, rather than the container on its next start: on 2026-09-22 a
# new import in vfr left both agents and both pipeline stages unable to
# start, and every build passed. The lazy imports are named too, as
# importing the entry module does not reach them.
RUN python -B -c "import app.main, app.mcp_server, uvicorn"
ENTRYPOINT ["python3", "-m", "app.main"]
