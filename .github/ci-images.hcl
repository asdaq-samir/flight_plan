# The three images the browser suite runs against in CI (the e2e job in
# workflows/ci.yml), for `docker buildx bake`: the same contexts and
# Dockerfiles docker-compose.yml builds them from, tagged the names
# docker-compose.ci.yml runs them under. A bake file rather than the
# compose files themselves, which bake reads too: its parser refuses
# their `networks: [default, …]`, which compose itself takes as read.
group "ci" {
  targets = ["webapp", "planning-service", "model-service"]
}

target "webapp" {
  context    = "."
  dockerfile = "springboot-app/Dockerfile"
  tags       = ["flight_plan-webapp:ci"]
}

target "planning-service" {
  context    = "."
  dockerfile = "planning-service/Dockerfile"
  tags       = ["flight_plan-planning-service:ci"]
}

target "model-service" {
  context    = "model-service"
  dockerfile = "Dockerfile"
  tags       = ["flight_plan-model-service:ci"]
}
