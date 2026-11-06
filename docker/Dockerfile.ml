# syntax=docker/dockerfile:1
# >>> wingtip-native: the same in every image that imports wingtip, kept so by
# tests/test_dockerfiles.py against docker/Dockerfile.native. wingtip's Rust
# extension (native/py, over wingtip-engine in native/engine), which wingtip
# imports at module level since the shared engine (2026-11-03): built
# here, with Rust copied in from its own image, so the image carries the
# wheel and none of the toolchain. The stage is the same text in each
# Dockerfile so that BuildKit's cache key is the same: one bake of every
# image compiles it once, and a commit that leaves native/ alone takes
# it from the registry's cache.
FROM python:3.14-slim AS native
COPY --from=rust:1.89-slim-bookworm /usr/local/cargo /usr/local/cargo
COPY --from=rust:1.89-slim-bookworm /usr/local/rustup /usr/local/rustup
ENV PATH=/usr/local/cargo/bin:$PATH CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev
RUN --mount=type=cache,target=/root/.cache/pip pip install maturin==1.9.4
COPY native /native
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    maturin build --release --compatibility linux -m /native/py/Cargo.toml -o /wheels
# <<< wingtip-native

# Python 3.13, not the 3.14 the other images use: TensorFlow has no stable
# release with 3.14 wheels yet (only 2.22.0rc0), so `pip install tensorflow`
# finds nothing on 3.14. Move up once a stable 2.22 ships. The native stage
# above is 3.14 like every other image's; its abi3 wheel installs on 3.13.
FROM python:3.13-slim

WORKDIR /workspace

# PySpark needs a JVM.
RUN apt-get update && apt-get install -y --no-install-recommends default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/default-java

# The heaviest and least-changing first, each layer ahead of the file
# the next one reads: torch (reads nothing), the frameworks (their own
# list), then wingtip's list and the notebooks' -- which change most, a
# pinned bump in src/requirements.txt being the usual reason this image
# rebuilds. Copied in before torch, as they were, one such bump
# downloaded, built (pyspark is a 450 MB source archive) and compressed
# every framework again: four and a half minutes of a CI run, where the
# last layer alone is well under one. What that costs: an unpinned
# framework is resolved when its layer is built and stays at that
# version until requirements-ml-frameworks.txt (or the base image)
# changes, rather than moving to the latest release with each bump of
# wingtip's; and a package wingtip pins that a framework pulled in at another
# version is installed again, in the last layer, at wingtip's.
#
# CPU-only wheel -- this container has no GPU to use, and the default
# torch wheel pulls several GB of unused CUDA/cuDNN dependencies.
RUN --mount=type=cache,target=/root/.cache/pip pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY docker/requirements-ml-frameworks.txt docker/
RUN --mount=type=cache,target=/root/.cache/pip pip install -r docker/requirements-ml-frameworks.txt
# Copied at the paths they have in the repo, so the image's list finds
# wingtip's own through its -r ../src/requirements.txt. This install is the
# whole list resolved together, as it always was; the frameworks are
# already satisfied, so it adds and adjusts only what the layers above
# do not have.
COPY src/requirements.txt src/
COPY docker/requirements-ml.txt docker/
RUN --mount=type=cache,target=/root/.cache/pip pip install -r docker/requirements-ml.txt
# The engine's wheel from the native stage above, mounted rather than
# copied, so no layer keeps it.
RUN --mount=type=bind,from=native,source=/wheels,target=/tmp/wheels \
    pip install --no-cache-dir --no-deps /tmp/wheels/*.whl
# The build fails here if a package the notebooks and wingtip import is
# missing, rather than a notebook cell later. This image carries no
# source (compose mounts the checkout), so it is the packages alone:
# wingtip's own list, then the notebooks'.
RUN python -B -c "import wingtip_native, numpy, pandas, requests, pyarrow.parquet, shapely.ops, shapefile, pyproj, scipy.spatial, pygeomag, astral, sklearn, joblib, matplotlib, PIL, folium, notebook, transformers, sentence_transformers, torch, tensorflow, pyspark.ml"

# Non-root, matching every other image built from this same
# python:3.14-slim base, bar this one and crewai-agent's (Dockerfile.processing, Dockerfile.training,
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
     "--NotebookApp.notebook_dir=/workspace", "--NotebookApp.token=wingtip"]
