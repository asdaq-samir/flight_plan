# Build context is the repository root, because the jar carries the front
# end: Spring Boot is the only public surface, so the bundle and the API
# it calls ship together and are served from one origin.

FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Vite's outDir points outside the app directory (into Spring Boot's
# static resources), so build with that layout present and collect the
# result from there.
RUN mkdir -p /springboot-app/src/main/resources/static \
    && npx vite build --outDir /springboot-app/src/main/resources/static/app --emptyOutDir

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY springboot-app/pom.xml .
RUN mvn -q dependency:go-offline
COPY springboot-app/src ./src
COPY --from=web /springboot-app/src/main/resources/static/app ./src/main/resources/static/app
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
