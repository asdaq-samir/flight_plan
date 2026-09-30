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

# The image the suite's tests run in: the Playwright image (PLAYWRIGHT_FROM,
# by its digest) without the three browsers the suite never launches --
# Chromium itself, Firefox and WebKit; the suite's headless Chromium is
# the headless shell -- as one layer, so their 1.1 of its 2.6 GB are not
# pulled, unpacked and written on every shard. Every other file is the
# image's own, byte for byte; the same page drawn in both came out the
# same, pixel for pixel. FROM scratch carries none of the image's
# settings, so its four are set again, as `docker image inspect` gives
# them. Pushed with zstd layers, which unpack several times faster than
# gzip, under PLAYWRIGHT_TAG (the e2e-images job's).
variable "PLAYWRIGHT_FROM" {
  default = ""
}
variable "PLAYWRIGHT_TAG" {
  default = ""
}

target "playwright" {
  dockerfile-inline = <<-EOT
    FROM ${PLAYWRIGHT_FROM} AS full
    RUN rm -rf /ms-playwright/chromium-[0-9]* /ms-playwright/firefox-* /ms-playwright/webkit-*
    FROM scratch
    COPY --from=full / /
    ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        LANG=C.UTF-8 LC_ALL=C.UTF-8 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
    CMD ["/bin/bash"]
  EOT
  platforms         = ["linux/amd64"]
  tags              = [PLAYWRIGHT_TAG]
  output            = ["type=registry,compression=zstd,force-compression=true,oci-mediatypes=true"]
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
