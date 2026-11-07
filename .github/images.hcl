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
# `<image>:sha-<SHA>`, never `latest`: the Promote workflow
# (workflows/promote.yml) gives it that name once CI has passed. PUSH is "true" on main; anywhere else the
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

# Every image, for a bake with no target named -- and the list the
# Promote workflow walks, promoting each this commit built.
group "default" {
  targets = ["ml", "pipeline-processing", "pipeline-training",
             "planning-service", "webapp"]
}

function "image" {
  params = [name]
  result = {
    tags       = ["${REGISTRY}/${name}:sha-${SHA}"]
    # The planner's cache too: every image that imports wingtip carries the
    # same wingtip-native stage (docker/Dockerfile.native), so the engine an
    # earlier run compiled for the planner is found by the others, not
    # compiled again for each image's own cache.
    cache-from = ["type=registry,ref=${REGISTRY}/${name}:buildcache",
                  "type=registry,ref=${REGISTRY}/planning-service:buildcache"]
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

target "planning-service" {
  context    = "."
  dockerfile = "planning-service/Dockerfile"
  tags       = image("planning-service").tags
  cache-from = image("planning-service").cache-from
  cache-to   = image("planning-service").cache-to
  output     = image("planning-service").output
}

target "webapp" {
  context    = "."
  dockerfile = "springboot-app/Dockerfile"
  tags       = image("webapp").tags
  cache-from = image("webapp").cache-from
  cache-to   = image("webapp").cache-to
  output     = image("webapp").output
}
