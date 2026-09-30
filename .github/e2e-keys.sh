#!/usr/bin/env bash
# The key of each image the browser suite runs (.github/ci-images.hcl):
# a hash of the files, as this commit has them, that decide what the
# image does in the suite's stack. An image is built once per key, by
# the e2e-images job, and a shard pulls one built by any earlier commit
# with the same key -- most commits change none of these, and a shard
# then waits for no build at all. One line per image: "<image> <key>".
#
#   webapp            its jar: springboot-app's Dockerfile, pom and
#                     sources. Not web/: the suite's stack serves the
#                     page from a bundle each shard builds from the
#                     commit, over the image's (docker-compose.ci.yml).
#   planning-service  its packages: the Dockerfile and the requirements
#                     it installs. Not its code, which the stack mounts
#                     from the checkout over the image's
#                     (docker-compose.yml).
#   model-service     its `slim` stage: the Dockerfile, the serving
#                     requirements and the service's code.
set -euo pipefail
key() { git ls-tree -r HEAD -- "$@" | git hash-object --stdin | cut -c1-16; }
echo "webapp $(key springboot-app/Dockerfile springboot-app/pom.xml springboot-app/src/main)"
echo "planning-service $(key planning-service/Dockerfile planning-service/requirements.txt src/requirements.txt src/requirements-charts.txt)"
echo "model-service $(key model-service/Dockerfile model-service/requirements-serving.txt model-service/app)"
