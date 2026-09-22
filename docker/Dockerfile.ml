# syntax=docker/dockerfile:1
FROM python:3.14-slim

WORKDIR /workspace

# PySpark needs a JVM.
RUN apt-get update && apt-get install -y --no-install-recommends default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/default-java

COPY docker/requirements-ml.txt .
# CPU-only wheel -- this container has no GPU to use, and the default
# torch wheel pulls several GB of unused CUDA/cuDNN dependencies.
RUN --mount=type=cache,target=/root/.cache/pip pip install torch --index-url https://download.pytorch.org/whl/cpu
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements-ml.txt

# Non-root, matching every other image built from this same
# python:3.13-slim base (Dockerfile.processing, Dockerfile.training,
# planning-service, model-service, nav-log-agent, crewai-agent) -- this
# one used to run (and need --allow-root for) root specifically,
# despite mounting the same `.:/workspace` bind mount the other two
# pipeline images already run non-root against: a notebook saved from
# inside this container was landing on the host owned by root, not the
# host user who'd then need sudo to edit or delete it.
RUN useradd -m appuser
USER appuser

EXPOSE 8888

CMD ["jupyter", "notebook", "--no-browser", "--ip=0.0.0.0", \
     "--NotebookApp.notebook_dir=/workspace", "--NotebookApp.token=vfr"]
