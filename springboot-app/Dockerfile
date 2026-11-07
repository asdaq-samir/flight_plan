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
FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS web
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
# The engine's contract, from which it generates the engine calls' types
# (web/src/lib/engine/contract.ts, committed, made again here).
COPY native/contract/engine.schema.json /native/contract/engine.schema.json
RUN npm run types && npx vite build --outDir /web/dist --emptyOutDir

# 25, not the truly-latest 26: spring-boot-maven-plugin 3.5.3's bundled
# JDK 25, the same LTS the app targets (pom.xml's java.version), runs on
# (the eclipse-temurin:25-jre stage below) and CI tests with. ASM in
# Spring Boot's `repackage` can't parse Java 26+ class files anyway.
FROM maven:3.9-eclipse-temurin-25@sha256:93b8a14ea2f412782e4e842651273b4d903e35cc496284f178fbbe2d67d00976 AS build
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
# The planner's OpenAPI document, from which the build generates the
# planner's answers PlannerClient reads (pom.xml's
# openapi-generator-maven-plugin): at ../planning-service from the pom,
# where it is in the repository too.
COPY planning-service/openapi.json /planning-service/openapi.json
# src/main alone: the tests are neither run here (-DskipTests) nor
# wanted in the layer, where an edited test rebuilt the jar.
COPY springboot-app/src/main ./src/main
RUN mvn -B -q package -DskipTests -Dmaven.repo.local=/build/m2

FROM eclipse-temurin:25-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0
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
