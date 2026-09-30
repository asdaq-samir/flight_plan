# syntax=docker/dockerfile:1
# Build context is the repository root, because the image carries the
# front end: Spring Boot is the only public surface, so the bundle and
# the API it calls ship together and are served from one origin.
#
# Two independent build stages, one runtime stage. The bundle is copied
# beside the jar rather than into it (WebMvcConfig serves it from
# APP_STATIC_LOCATION), so a front-end change rebuilds only the `web`
# stage and a Java change only the `build` stage -- neither waits on the
# other's toolchain.

# Node's LTS line, the major in .nvmrc (which CI's web job reads).
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
# --mount=type=cache: npm's own download/extract cache, keyed by this
# stage -- survives across builds (unlike the layer cache, which a
# `COPY web/ ./` below still invalidates on every source change) so
# `npm ci` doesn't re-download the same packages every time.
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
# The planner's and this app's own OpenAPI documents, from which `npm run
# types` generates the front end's API types (web/src/lib/api/schema.d.ts
# and webapp-schema.d.ts, not committed).
COPY planning-service/openapi.json /planning-service/openapi.json
COPY springboot-app/openapi.json /springboot-app/openapi.json
RUN npm run types && npx vite build --outDir /web/dist --emptyOutDir

# 25, not the truly-latest 26: spring-boot-maven-plugin 3.5.3's bundled
# ASM can't yet parse a Java 26 class file (major version 70) --
# `repackage` fails with "Unsupported class file major version 70".
# 25 (major version 69) is the newest JDK it actually understands.
FROM maven:3.9.16-eclipse-temurin-25 AS build
WORKDIR /build
COPY springboot-app/pom.xml .
# The dependencies into the layer itself (/build/m2), not only into the
# cache mount. A cache mount belongs to the machine that built it and is
# not exported with the layer cache: on a CI runner restoring the layers
# from the registry this step was a hit, the mount was empty, and
# `mvn package` below downloaded every dependency again on each commit.
# The mount stays, as the local download cache for a changed pom.
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -B -q dependency:go-offline && cp -R /root/.m2/repository /build/m2
# src/main alone: the tests are neither run here (-DskipTests) nor
# wanted in the layer, where an edited test rebuilt the jar.
COPY springboot-app/src/main ./src/main
RUN mvn -B -q package -DskipTests -Dmaven.repo.local=/build/m2

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
COPY --from=web /web/dist ./static/app
ENV APP_STATIC_LOCATION=file:/app/static/app/
# /cds: where the JVM keeps its class-data-sharing archive when
# docker-compose.yml asks for one (-XX:+AutoCreateSharedArchive) -- a
# named volume, so it outlives the container and the next start of the
# same jar skips class loading and verification it already did.
RUN useradd -m appuser && chown appuser /app/app.jar && mkdir /cds && chown appuser /cds
USER appuser
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
