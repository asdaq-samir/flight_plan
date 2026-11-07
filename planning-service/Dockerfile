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

# tippecanoe (felt/tippecanoe), which makes the map's FAA overlays into
# vector tiles once a cycle (wingtip.vector_tiles): built from its tagged
# release, the tarball checked against its sum, on the same Debian as the
# image below so the binaries find the same sqlite and zlib there. Only
# the two programs are copied on: tippecanoe, and tippecanoe-decode, which
# the tests read an archive back with.
FROM python:3.14-slim AS tippecanoe
ARG TIPPECANOE_VERSION=2.79.0
ARG TIPPECANOE_SHA256=b0fd9df49b6efc988288ea48774822c6de19eb48428017f27ee0b3b01d44f05d
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update && apt-get install -y --no-install-recommends build-essential libsqlite3-dev zlib1g-dev curl ca-certificates
RUN curl -fsSL -o /tmp/tippecanoe.tar.gz "https://github.com/felt/tippecanoe/archive/refs/tags/${TIPPECANOE_VERSION}.tar.gz" \
    && echo "${TIPPECANOE_SHA256}  /tmp/tippecanoe.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/tippecanoe.tar.gz -C /tmp \
    && make -C "/tmp/tippecanoe-${TIPPECANOE_VERSION}" -j"$(nproc)" tippecanoe tippecanoe-decode \
    && install -m 755 "/tmp/tippecanoe-${TIPPECANOE_VERSION}/tippecanoe" "/tmp/tippecanoe-${TIPPECANOE_VERSION}/tippecanoe-decode" /usr/local/bin/

FROM python:3.14-slim

WORKDIR /workspace/planning-service

# rasterio's wheel bundles GDAL, which links libexpat for its XML
# (GeoTIFF metadata, VRTs) and does not bundle it; without this the
# import fails on the slim image.
# apt's package cache in a cache mount, like pip's below: the layer is
# what CI restores, the mount only saves a local rebuild the download.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update && apt-get install -y --no-install-recommends libexpat1 libsqlite3-0 zlib1g libstdc++6
COPY --from=tippecanoe /usr/local/bin/tippecanoe /usr/local/bin/tippecanoe-decode /usr/local/bin/
# The user before the source, which changes every commit: this layer
# then stays cached with the dependencies. The data folder is the
# user's: the stacks mount theirs over it, but the chart refresh task on
# Fargate mounts nothing and writes the cycle's sheets and tiles there.
RUN useradd -m appuser && mkdir -p /workspace/data && chown appuser:appuser /workspace/data

# The service's own list includes wingtip's (-r ../src/requirements-charts.txt),
# so both are copied to where that relative path points.
COPY src/requirements.txt src/requirements-charts.txt /workspace/src/
COPY planning-service/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
# The engine's wheel from the native stage above, mounted rather than
# copied, so no layer keeps it.
RUN --mount=type=bind,from=native,source=/wheels,target=/tmp/wheels \
    pip install --no-cache-dir --no-deps /tmp/wheels/*.whl

COPY planning-service/app ./app
COPY src /workspace/src

USER appuser

ENV PYTHONPATH=/workspace/src
# The build fails here if a package this image's code imports is
# missing, rather than the container on its next start: on 2026-09-22 a
# new import in wingtip left both agents and both pipeline stages unable to
# start, and every build passed. The lazy imports are named too, as
# importing the entry module does not reach them.
RUN python -B -c "import app.main, wingtip_native, rasterio.vrt, rasterio.warp, rasterio.features, affine, scipy.ndimage, boto3, pyarrow.parquet, shapely.ops, sklearn, joblib" \
    && tippecanoe --version
# GDAL's block cache defaults to 5% of the machine's RAM and holds
# decoded chart raster blocks across tile renders; bounded, so that
# rendering a screenful of zoomed-out tiles (each reading a wide window
# of several sheets) cannot grow this process past what the compose
# stack's VM can spare. Once the pyramid is pre-rendered the cache is
# idle anyway. MALLOC_ARENA_MAX for the same reason: tiles render on
# uvicorn's worker threads, and glibc's default of one 64 MB malloc
# arena per thread let the process fragment its way to 3 GB resident
# after a few screenfuls of zoomed-out tiles that a single-threaded
# render of the same tiles does in 300 MB.
ENV GDAL_CACHEMAX=128 MALLOC_ARENA_MAX=2
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
