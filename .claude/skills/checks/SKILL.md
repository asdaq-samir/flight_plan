---
name: checks
description: Run the checks that cover a change in this repo, on the owner's Mac (in containers, since it has no npm or pytest) or in CI, and read failures correctly. Use after editing code and before saying anything works, before committing, and whenever a test, a build or the running stack fails. Covers web (tsc, eslint, vitest), src/vfr and the Python services, the Spring Boot app, OpenAPI types, the running stack, Playwright, the iPhone audit and WebKit.
---

# Checks

CLAUDE.md says what to run for each part of the repo; this says how to run it here.

**Where you are running matters:**
- **In CI (GitHub's runners):** the workflow sets up node, Python 3.13 and Java 25. Run CLAUDE.md's commands directly, after `pip install -r requirements-dev.txt` in that directory, and skip sections 3 and 4.
- **On the owner's Mac:** it has no node, npm, pytest or ruff, so everything runs in a container from the repo root. Chain every step with `&&` so that one failure stops the rest. Report exit codes, never an "OK" marker found with grep: an old marker can look like a new pass.

## 1. What the change needs

| Changed | Run | Then |
|---|---|---|
| `web/` | Web checks, then the specs the change touches | the whole suite once before a push |
| `src/vfr`, `tests/` | Python at the root | restart the planner (it mounts `src`) |
| `planning-service/` | Python in `planning-service` | restart the planner |
| `model-service/`, `nav-log-agent/`, `crewai-agent/` | Python in that service | rebuild that service |
| `springboot-app/` | Java | rebuild the webapp |
| an API's request or response | regenerate its OpenAPI document, then `npm run types` | commit all three |
| any `requirements*.txt`, `pom.xml`, `package.json` or Dockerfile | rebuild every image that installs it | before verifying anything |

## 2. Commands

**Web.** These are CI's steps; node 24 matches `.nvmrc`.
```sh
docker run --rm -v "$PWD":/repo -w /repo/web node:24-slim sh -c 'npm run -s types && npx tsc --noEmit && npx eslint . && npx vitest run'
```

**Python.** This mirrors CI: Python 3.13, the directory's `requirements-dev.txt` installed with uv, and a cache volume that brings a repeat run down to under a minute. Use `-w /repo` with `ruff check src/vfr tests`, or `-w /repo/<service>` with `ruff check app tests`. For nav-log-agent, first run `uv pip install --system torch --index-url https://download.pytorch.org/whl/cpu`.
```sh
docker run --rm -v "$PWD":/repo -v fp-uv-cache:/root/.cache/uv -w /repo/planning-service python:3.13-slim sh -c 'pip install -q uv && uv pip install --system -q -r requirements-dev.txt && ruff check app tests && pytest tests/ -q -p no:cacheprovider'
```
The planner's OpenAPI document comes from the same container: `python -m app.openapi` in `planning-service`.

**Java.** Java 25 is required. The socket mount and the host override are what let Testcontainers start Postgres. The anonymous `target` volume keeps any stray host build output out of the run. `fp-m2` caches Maven's downloads, so never prune it.
```sh
docker run --rm -v "$PWD/springboot-app":/build -v /build/target -v fp-m2:/root/.m2 -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -w /build maven:3.9-eclipse-temurin-25 mvn -B test
```
To rewrite `springboot-app/openapi.json`, run the same command with `-e WRITE_OPENAPI=1 … mvn -B test -Dtest=OpenApiDocumentTest`.

## 3. The running stack

The stack runs with three compose files and the `ai` profile. Name the services, so that airflow, which has no profile, stays down:
```sh
docker compose -f docker-compose.yml -f docker-compose.phone.yml -f docker-compose.web-dev.yml --profile ai up -d webapp model-service planning-service web-build nav-log-agent crewai-agent db mailpit dev-services
```
- Pass all three `-f` files on every `up` that touches the webapp. Without `web-dev` it serves the bundle baked into its image, so a fix seems "not to work". Without `phone`, the iPhone loses the app. To check what the running webapp was started with: `docker inspect flight_plan-webapp-1 --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'`.
- **Web change:** `web-build` (vite `--watch`) rewrites `web/dist` about 2 s after a save, and the webapp serves it on the next request. Nothing needs restarting.
- **Python change in `src/` or the planner:** run `docker compose restart planning-service`, then wait until `curl -s localhost:8084/` shows `"warm":true`.
- **Java or dependency change:** run `up -d --build --no-deps <service>` with the same three files. Then wait until `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/app/plan` prints 200, which takes 20 to 30 s after the container starts. Read `docker compose logs --tail=30 <service>` for import errors: a container can show "running" and still fail to import its own code. To prove a service imports what it uses, run `docker compose run --rm --no-deps -T --entrypoint python3 <service> -c "from vfr import …"` with that service's real list, from `grep -rh "from vfr import" <service>/app`.
- **Before building images:** check `df -h /System/Volumes/Data` and run `docker builder prune` when under about 20 GB is free. Docker's VM is capped at 6 GB, so never run a second stack or a heavy job beside the suite.

## 4. Playwright

```sh
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/web":/w -w /w \
  -e BASE_URL=http://host.docker.internal:8080 -e MAILPIT_URL=http://host.docker.internal:8025 \
  -e MAILPIT_UI_AUTH="$(grep '^MAILPIT_UI_AUTH=' .env | cut -d= -f2-)" \
  mcr.microsoft.com/playwright:v1.55.1-noble npx playwright test e2e/<spec>.spec.ts --reporter=list
```
- The image tag must equal `@playwright/test` in `web/package.json`. Change both together.
- The `setup` project signs in developer@example.com through Mailpit, and every spec reuses that session.
- While iterating, run the touched specs. Run the whole suite (about 180 tests, 4 to 5 minutes) once before a push. Keep the full log rather than piping it through `tail`, so the details of a real failure survive.
- **iPhone audit:** `e2e/ios` runs on three devices in every run. `IOS_AUDIT=1` takes all eight, plus `--project=webkit-iphone --workers=2` for Safari's engine.
- **WebKit-only bugs:** the suite is Chromium. When the user reports something from the phone that the suite passes, reproduce it in WebKit before guessing. Write a scratch `.cjs` script with `require("@playwright/test").webkit` and `storageState: "/w/e2e/.auth/developer.json"`, and run it in the same image with `-e NODE_PATH=/w/node_modules`. Abort every write with `page.route(…, r => r.abort())` so the user's data isn't touched.
- **Changes to CI's e2e job, `docker-compose.ci.yml` or the planner's startup** can pass here and fail in CI. Simulate CI first: clone into the scratchpad, shift the clone's host ports, build with `-p fpci -f docker-compose.yml -f docker-compose.ci.yml`, keep `CHARTS_AUTO_REFRESH=0`, wait for `warm`, and run with `-e CI=1` with nothing else heavy running. Tear down with `down -v --rmi all` and `docker builder prune -af`.

## 5. Reading a failure

Rule these out before calling something a regression:
1. **Boot race:** the first mobile tests fail right after a rebuild. Wait for `/app/plan` to return 200, then rerun.
2. **Stale code:** a change "doesn't work". Check the webapp's compose files (above) and whether the image needed a rebuild for a dependency.
3. **Load:** nav-log or map tests time out while a chart re-render, an image build or a second suite is running. Rerun on a quiet stack.
4. **A planner wedged after disk or data trouble:** restart it and wait for `warm`.
5. **Safari only:** reproduce in WebKit.

A failure that repeats on a quiet, freshly built stack is real. In the report, say which checks ran, with their counts, and which didn't.
