# The three images the browser suite runs against in CI (the e2e job in
# workflows/ci.yml), for `docker buildx bake`: the same contexts and
# Dockerfiles docker-compose.yml builds them from, tagged the names
# docker-compose.ci.yml runs them under. A bake file rather than the
# compose files themselves, which bake reads too: its parser refuses
# their `networks: [default, …]`, which compose itself takes as read.
#
# CACHE_REGISTRY (ghcr.io/<owner>/<repo>, from the workflow): the
# registry cache build-images writes on main, one `:buildcache` tag per
# image. Empty, as on a machine of one's own, nothing is read.
variable "CACHE_REGISTRY" {
  default = ""
}

function "cache" {
  params = [image]
  result = CACHE_REGISTRY == "" ? [] : ["type=registry,ref=${CACHE_REGISTRY}/${image}:buildcache"]
}

group "ci" {
  targets = ["webapp", "planning-service", "model-service"]
}

target "webapp" {
  context    = "."
  dockerfile = "springboot-app/Dockerfile"
  tags       = ["flight_plan-webapp:ci"]
  cache-from = cache("webapp")
}

target "planning-service" {
  context    = "."
  dockerfile = "planning-service/Dockerfile"
  tags       = ["flight_plan-planning-service:ci"]
  cache-from = cache("planning-service")
}

# `slim`: the scikit-learn serving stack alone, which is all the suite's
# fixture model needs -- the full image's torch and tensorflow were four
# of the five gigabytes each runner loaded. See model-service/Dockerfile.
target "model-service" {
  context    = "model-service"
  dockerfile = "Dockerfile"
  target     = "slim"
  tags       = ["flight_plan-model-service:ci"]
  cache-from = cache("model-service")
}
