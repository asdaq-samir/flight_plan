#!/usr/bin/env bash
# The key of each image the browser suite runs (.github/ci-images.hcl),
# and of the page its webapp serves: a hash of the files, as this commit
# has them, that decide what each does in the suite's stack. Each is
# built once per key, by the e2e-images job, and a shard pulls the one
# built by any earlier commit with the same key -- most commits change
# none of the images', and a shard then waits for no image to be built.
# One line each: "<name> <key>".
#
#   webapp            its jar: springboot-app's Dockerfile, pom and
#                     sources. Not web/: the suite's stack serves the
#                     page below, mounted over the image's
#                     (docker-compose.ci.yml).
#   planning-service  its packages: the Dockerfile and the requirements
#                     it installs. Not its code, which the stack mounts
#                     from the checkout over the image's
#                     (docker-compose.yml).
#   model-service     its `slim` stage: the Dockerfile, the serving
#                     requirements and the service's code.
#   page              the page: web/ but its browser suite (web/e2e),
#                     the two API documents its types are made from, and
#                     the Node it is built with.
#
# An image's key begins with how the images are pushed (ci-images.hcl's
# `pushed`), so that a change there is a new image for every key.
set -euo pipefail
key() { { echo "zstd"; git ls-tree -r HEAD -- "$@"; } | git hash-object --stdin | cut -c1-16; }
echo "webapp $(key springboot-app/Dockerfile springboot-app/pom.xml springboot-app/src/main)"
echo "planning-service $(key planning-service/Dockerfile planning-service/requirements.txt src/requirements.txt src/requirements-charts.txt)"
echo "model-service $(key model-service/Dockerfile model-service/requirements-serving.txt model-service/app)"
echo "page $(git ls-tree -r HEAD -- web planning-service/openapi.json springboot-app/openapi.json .nvmrc \
  | grep -v $'\tweb/e2e/' | git hash-object --stdin | cut -c1-16)"
