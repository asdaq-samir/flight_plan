# Build context is the repository root, because the jar carries the front
# end: Spring Boot is the only public surface, so the bundle and the API
# it calls ship together and are served from one origin.

FROM node:26-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Vite's outDir points outside the app directory (into Spring Boot's
# static resources), so build with that layout present and collect the
# result from there.
RUN mkdir -p /springboot-app/src/main/resources/static \
    && npx vite build --outDir /springboot-app/src/main/resources/static/app --emptyOutDir

# 25, not the truly-latest 26: spring-boot-maven-plugin 3.5.3's bundled
# ASM can't yet parse a Java 26 class file (major version 70) --
# `repackage` fails with "Unsupported class file major version 70".
# 25 (major version 69) is the newest JDK it actually understands.
FROM maven:3-eclipse-temurin-26 AS build
WORKDIR /build
COPY springboot-app/pom.xml .
RUN mvn -q dependency:go-offline
COPY springboot-app/src ./src
COPY --from=web /springboot-app/src/main/resources/static/app ./src/main/resources/static/app
RUN mvn -q package -DskipTests

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
