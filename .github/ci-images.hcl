# The three images the browser suite runs against in CI (the e2e job in
# workflows/ci.yml), for `docker buildx bake`: the same contexts and
# Dockerfiles docker-compose.yml builds them from. A bake file rather
# than the compose files themselves, which bake reads too: its parser
# refuses their `networks: [default, …]`, which compose itself takes as
# read.
#
# REGISTRY (ghcr.io/<owner>/<repo>, from the workflow): where the
# registry cache build-images writes on main lives, one `:buildcache` tag
# per image, and where the e2e-images job pushes these three. Empty, as
# on a machine of one's own, nothing is read.
variable "REGISTRY" {
  default = ""
}

# TAG (e2e-<commit>, from the e2e-images job): the tag each image is
# pushed under, for the shards to pull, and `e2e` beside it, which always
# names the last ones pushed -- what a shard pulls first, for the layers
# this commit's will share with it. Pushed with their cache inline, so
# the next build finds its own last layers too: the model service's
# `slim` stage is in no other cache, since build-images builds the full
# image. Empty (a pull request's shards, which build their own): tagged
# the names docker-compose.ci.yml runs them by, and nothing pushed.
variable "TAG" {
  default = ""
}

function "cache" {
  params = [image]
  result = REGISTRY == "" ? [] : ["type=registry,ref=${REGISTRY}/${image}:buildcache", "type=registry,ref=${REGISTRY}/${image}:e2e"]
}

function "tags" {
  params = [image]
  result = TAG == "" ? ["flight_plan-${image}:ci"] : ["${REGISTRY}/${image}:${TAG}", "${REGISTRY}/${image}:e2e"]
}

group "ci" {
  targets = ["webapp", "planning-service", "model-service"]
}

target "webapp" {
  context    = "."
  dockerfile = "springboot-app/Dockerfile"
  tags       = tags("webapp")
  cache-from = cache("webapp")
  cache-to   = TAG == "" ? [] : ["type=inline"]
}

target "planning-service" {
  context    = "."
  dockerfile = "planning-service/Dockerfile"
  tags       = tags("planning-service")
  cache-from = cache("planning-service")
  cache-to   = TAG == "" ? [] : ["type=inline"]
}

# `slim`: the scikit-learn serving stack alone, which is all the suite's
# fixture model needs -- the full image's torch and tensorflow were four
# of the five gigabytes each runner loaded. See model-service/Dockerfile.
target "model-service" {
  context    = "model-service"
  dockerfile = "Dockerfile"
  target     = "slim"
  tags       = tags("model-service")
  cache-from = cache("model-service")
  cache-to   = TAG == "" ? [] : ["type=inline"]
}
