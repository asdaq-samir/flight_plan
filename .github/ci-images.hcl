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

# Each image's key (.github/e2e-keys.sh, from the e2e-images job): the
# tag it is pushed under, `e2e-<key>`, for the shards to pull, and `e2e`
# beside it, which always names the last one pushed -- what a shard pulls
# first, for the layers a new key's image will share with it. Pushed
# with their cache inline, so the next build finds its own last layers
# too: the model service's `slim` stage is in no other cache, since
# build-images builds the full image. Empty (a pull request's shard
# building one itself): tagged the name docker-compose.ci.yml runs it
# by, and nothing pushed.
variable "WEBAPP_KEY" {
  default = ""
}
variable "PLANNING_SERVICE_KEY" {
  default = ""
}
variable "MODEL_SERVICE_KEY" {
  default = ""
}

function "cache" {
  params = [image]
  result = REGISTRY == "" ? [] : ["type=registry,ref=${REGISTRY}/${image}:buildcache", "type=registry,ref=${REGISTRY}/${image}:e2e"]
}

function "tags" {
  params = [image, key]
  result = key == "" ? ["flight_plan-${image}:ci"] : ["${REGISTRY}/${image}:e2e-${key}", "${REGISTRY}/${image}:e2e"]
}

group "ci" {
  targets = ["webapp", "planning-service", "model-service"]
}

target "webapp" {
  context    = "."
  dockerfile = "springboot-app/Dockerfile"
  tags       = tags("webapp", WEBAPP_KEY)
  cache-from = cache("webapp")
  cache-to   = WEBAPP_KEY == "" ? [] : ["type=inline"]
}

target "planning-service" {
  context    = "."
  dockerfile = "planning-service/Dockerfile"
  tags       = tags("planning-service", PLANNING_SERVICE_KEY)
  cache-from = cache("planning-service")
  cache-to   = PLANNING_SERVICE_KEY == "" ? [] : ["type=inline"]
}

# `slim`: the scikit-learn serving stack alone, which is all the suite's
# fixture model needs -- the full image's torch and tensorflow were four
# of the five gigabytes each runner loaded. See model-service/Dockerfile.
target "model-service" {
  context    = "model-service"
  dockerfile = "Dockerfile"
  target     = "slim"
  tags       = tags("model-service", MODEL_SERVICE_KEY)
  cache-from = cache("model-service")
  cache-to   = MODEL_SERVICE_KEY == "" ? [] : ["type=inline"]
}
