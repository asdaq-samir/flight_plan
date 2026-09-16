# Build the frontend in a container, like Maven and the Python services --
# no native Node toolchain needed to work on this project.
FROM node:26-slim AS build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build
