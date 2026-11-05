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
FROM python:3.13-slim AS native
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
# The engine's wheel from the native stage above, mounted rather than
# copied, so no layer keeps it.
RUN --mount=type=bind,from=native,source=/wheels,target=/tmp/wheels \
    pip install --no-cache-dir --no-deps /tmp/wheels/*.whl

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
# new import in wingtip left both agents and both pipeline stages unable to
# start, and every build passed. The lazy imports are named too, as
# importing the entry module does not reach them.
RUN python -B -c "import wingtip_native, app.main, app.mcp_server, uvicorn"
ENTRYPOINT ["python3", "-m", "app.main"]
