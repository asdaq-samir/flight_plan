# syntax=docker/dockerfile:1
FROM python:3.14-slim

WORKDIR /workspace

# PySpark needs a JVM.
RUN apt-get update && apt-get install -y --no-install-recommends default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/default-java

# The heaviest and least-changing first, each layer ahead of the file
# the next one reads: torch (reads nothing), the frameworks (their own
# list), then vfr's list and the notebooks' -- which change most, a
# pinned bump in src/requirements.txt being the usual reason this image
# rebuilds. Copied in before torch, as they were, one such bump
# downloaded, built (pyspark is a 450 MB source archive) and compressed
# every framework again: four and a half minutes of a CI run, where the
# last layer alone is well under one. What that costs: an unpinned
# framework is resolved when its layer is built and stays at that
# version until requirements-ml-frameworks.txt (or the base image)
# changes, rather than moving to the latest release with each bump of
# vfr's; and a package vfr pins that a framework pulled in at another
# version is installed again, in the last layer, at vfr's.
#
# CPU-only wheel -- this container has no GPU to use, and the default
# torch wheel pulls several GB of unused CUDA/cuDNN dependencies.
RUN --mount=type=cache,target=/root/.cache/pip pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY docker/requirements-ml-frameworks.txt docker/
RUN --mount=type=cache,target=/root/.cache/pip pip install -r docker/requirements-ml-frameworks.txt
# Copied at the paths they have in the repo, so the image's list finds
# vfr's own through its -r ../src/requirements.txt. This install is the
# whole list resolved together, as it always was; the frameworks are
# already satisfied, so it adds and adjusts only what the layers above
# do not have.
COPY src/requirements.txt src/
COPY docker/requirements-ml.txt docker/
RUN --mount=type=cache,target=/root/.cache/pip pip install -r docker/requirements-ml.txt
# The build fails here if a package the notebooks and vfr import is
# missing, rather than a notebook cell later. This image carries no
# source (compose mounts the checkout), so it is the packages alone:
# vfr's own list, then the notebooks'.
RUN python -B -c "import numpy, pandas, requests, pyarrow.parquet, shapely.ops, shapefile, pyproj, scipy.spatial, pygeomag, astral, sklearn, joblib, matplotlib, PIL, folium, notebook, transformers, sentence_transformers, torch, tensorflow, pyspark.ml"

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
