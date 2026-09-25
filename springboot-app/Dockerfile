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

FROM maven:3.9.16-eclipse-temurin-25 AS build
WORKDIR /build
COPY springboot-app/pom.xml .
RUN --mount=type=cache,target=/root/.m2/repository mvn -q dependency:go-offline
COPY springboot-app/src ./src
RUN --mount=type=cache,target=/root/.m2/repository mvn -q package -DskipTests

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
COPY --from=web /web/dist ./static/app
ENV APP_STATIC_LOCATION=file:/app/static/app/
RUN useradd -m appuser && chown appuser /app/app.jar
USER appuser
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
