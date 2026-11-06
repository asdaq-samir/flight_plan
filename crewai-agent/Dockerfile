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

# Python 3.13, not the 3.14 the other images use: crewai declares
# requires-python <3.14 (1.15.22 and the newest release alike). Move up
# once crewai allows 3.14; the ci.yml test-crewai-agent job matches this.
# The native stage above is 3.14 like every other image's; its abi3 wheel
# installs on 3.13.
FROM python:3.13-slim

WORKDIR /workspace/crewai-agent

COPY crewai-agent/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
# The engine's wheel from the native stage above, mounted rather than
# copied, so no layer keeps it.
RUN --mount=type=bind,from=native,source=/wheels,target=/tmp/wheels \
    pip install --no-cache-dir --no-deps /tmp/wheels/*.whl

COPY crewai-agent/app ./app
COPY src /workspace/src

RUN useradd -m appuser
USER appuser

ENV PYTHONPATH=/workspace/src
# The build fails here if a package this image's code imports is
# missing, rather than the container on its next start: on 2026-09-22 a
# new import in wingtip left both agents and both pipeline stages unable to
# start, and every build passed. The lazy imports are named too, as
# importing the entry module does not reach them.
RUN python -B -c "import wingtip_native, app.server, app.main"
# The HTTP wrapper the webapp's flight planning drawer calls. The one-shot CLI is
# `python3 -m app.main ...`, passed as the command instead.
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000"]
