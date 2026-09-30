# Every image this repository ships, for `docker buildx bake` in the
# build-images job (workflows/ci.yml): the contexts and Dockerfiles
# docker-compose.yml builds them from, built together by one BuildKit,
# in parallel. They were a job each, three runners at a time, and each
# runner spent 8 to 19 seconds starting a builder before a build of 8 to
# 12 -- on a run that changed them all, the last one ended two minutes
# in, behind the rest of the run.
#
# REGISTRY: ghcr.io/<owner>/<repo>, where each image's layer cache lives
# (`<image>:buildcache`, every stage's layers, written from main only)
# and where main pushes the image under this commit's tag,
# `<image>:sha-<SHA>`, never `latest`: promote gives it that name once
# every test has passed. PUSH is "true" on main; anywhere else the
# images are built and not pushed, the build being the check that each
# Dockerfile still builds.
variable "REGISTRY" {
  default = ""
}
variable "SHA" {
  default = ""
}
variable "PUSH" {
  default = "false"
}

function "image" {
  params = [name]
  result = {
    tags       = ["${REGISTRY}/${name}:sha-${SHA}"]
    cache-from = ["type=registry,ref=${REGISTRY}/${name}:buildcache"]
    cache-to   = PUSH == "true" ? ["type=registry,ref=${REGISTRY}/${name}:buildcache,mode=max,image-manifest=true,oci-mediatypes=true"] : []
    output     = PUSH == "true" ? ["type=registry"] : ["type=cacheonly"]
  }
}

target "ml" {
  context    = "."
  dockerfile = "docker/Dockerfile.ml"
  tags       = image("ml").tags
  cache-from = image("ml").cache-from
  cache-to   = image("ml").cache-to
  output     = image("ml").output
}

target "pipeline-processing" {
  context    = "."
  dockerfile = "docker/Dockerfile.processing"
  tags       = image("pipeline-processing").tags
  cache-from = image("pipeline-processing").cache-from
  cache-to   = image("pipeline-processing").cache-to
  output     = image("pipeline-processing").output
}

target "pipeline-training" {
  context    = "."
  dockerfile = "docker/Dockerfile.training"
  tags       = image("pipeline-training").tags
  cache-from = image("pipeline-training").cache-from
  cache-to   = image("pipeline-training").cache-to
  output     = image("pipeline-training").output
}

target "airflow" {
  context    = "."
  dockerfile = "docker/Dockerfile.airflow"
  tags       = image("airflow").tags
  cache-from = image("airflow").cache-from
  cache-to   = image("airflow").cache-to
  output     = image("airflow").output
}

target "airflow-aws" {
  context    = "."
  dockerfile = "docker/Dockerfile.airflow.aws"
  tags       = image("airflow-aws").tags
  cache-from = image("airflow-aws").cache-from
  cache-to   = image("airflow-aws").cache-to
  output     = image("airflow-aws").output
}

target "nav-log-agent" {
  context    = "."
  dockerfile = "nav-log-agent/Dockerfile"
  tags       = image("nav-log-agent").tags
  cache-from = image("nav-log-agent").cache-from
  cache-to   = image("nav-log-agent").cache-to
  output     = image("nav-log-agent").output
}

target "crewai-agent" {
  context    = "."
  dockerfile = "crewai-agent/Dockerfile"
  tags       = image("crewai-agent").tags
  cache-from = image("crewai-agent").cache-from
  cache-to   = image("crewai-agent").cache-to
  output     = image("crewai-agent").output
}

target "planning-service" {
  context    = "."
  dockerfile = "planning-service/Dockerfile"
  tags       = image("planning-service").tags
  cache-from = image("planning-service").cache-from
  cache-to   = image("planning-service").cache-to
  output     = image("planning-service").output
}

# Its own directory as the context, where every other image reads from
# the repository root (the webapp builds web/ into its first stage, the
# Python images copy src/).
target "model-service" {
  context    = "model-service"
  dockerfile = "Dockerfile"
  tags       = image("model-service").tags
  cache-from = image("model-service").cache-from
  cache-to   = image("model-service").cache-to
  output     = image("model-service").output
}

target "webapp" {
  context    = "."
  dockerfile = "springboot-app/Dockerfile"
  tags       = image("webapp").tags
  cache-from = image("webapp").cache-from
  cache-to   = image("webapp").cache-to
  output     = image("webapp").output
}
