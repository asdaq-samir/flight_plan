# syntax=docker/dockerfile:1
FROM python:3.14-slim

WORKDIR /workspace/planning-service

# rasterio's wheel bundles GDAL, which links libexpat for its XML
# (GeoTIFF metadata, VRTs) and does not bundle it; without this the
# import fails on the slim image.
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*

COPY planning-service/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY planning-service/app ./app
COPY src /workspace/src

RUN useradd -m appuser
USER appuser

ENV PYTHONPATH=/workspace/src
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
