package com.northflyers.vfr.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.server.PathContainer;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/**
 * The planner's API, reached through this service rather than directly.
 *
 * <p>Chart reading is Python's -- numpy and scipy over raster tiles, and
 * there is no reason to rewrite that in Java. What there is reason to do
 * is stop it being a second front door. With this in place the planner
 * service publishes no port of its own, and every browser-reachable path
 * arrives here, where the session already exists and one set of rules
 * applies.
 *
 * <p>Responses are piped rather than buffered, by {@link StreamingProxy},
 * which also owns the pinned HTTP/1.1 client and the error shape.
 * Detection streams newline-delimited JSON a tile block at a time so the
 * map fills from the departure end while the rest is still being read;
 * collecting that into a String before forwarding it would turn a
 * progressive response into a five-second wait.
 */
@RestController
@RequestMapping("/api/planner")
@Tag(name = "Planner", description = "Chart vision, course and nav log, proxied from the planner service")
public class PlannerProxyController {

    /** Long, because a cold corridor read is tens of seconds and a
     *  collection job is minutes. The client is what should give up. */
    private static final Duration TIMEOUT = Duration.ofMinutes(10);

    private static final StreamingProxy.Upstream PLANNER = new StreamingProxy.Upstream(
            "planner service", "planner service unreachable", "planner service timed out");

    /** The two chart-tile paths, plus the one that serves either kind.
     *  Only these carry their upstream's Cache-Control -- see
     *  {@link #forward}. */
    private static final String[] TILE_PATHS = {
        "/api/sectional-tile/", "/api/tac-tile/", "/api/chart-tile/",
    };

    private record Route(String method, PathPattern pattern) {
        boolean matches(String method, PathContainer path) {
            return this.method.equals(method) && pattern.matches(path);
        }
    }

    private static Route route(String method, String pattern) {
        return new Route(method, PathPatternParser.defaultInstance.parse(pattern));
    }

    /**
     * Every planner endpoint the browser may reach, and nothing else.
     *
     * <p>Forwarding {@code /**} whole made every route the planner ever
     * grew public the day it was added, its own API docs included, and
     * left the access rules in {@code SecurityConfig} as the only thing
     * between a caller and the service. A path not listed here is a 404
     * from this class, and the planner is never asked.
     */
    private static final List<Route> ROUTES = List.of(
            route("GET", "/api/course"),
            route("GET", "/api/checkpoints"),
            route("GET", "/api/navlog"),
            route("GET", "/api/plan"),
            route("GET", "/api/altitude-breakdown"),
            route("GET", "/api/briefing"),
            route("GET", "/api/class-b"),
            route("GET", "/api/routes"),
            route("GET", "/api/airports/search"),
            route("GET", "/api/aircraft-profiles"),
            route("GET", "/api/chart-tile/{kind}/{z}/{x}/{y}.png"),
            route("GET", "/api/sectional-tile/{z}/{x}/{y}.png"),
            route("GET", "/api/tac-tile/{z}/{x}/{y}.png"),
            route("GET", "/api/checkpoint-notes"),
            route("POST", "/api/checkpoint-notes"),
            route("POST", "/api/checkpoint-notes/generate"),
            route("POST", "/api/build"),
            route("GET", "/api/build/{jobId}"),
            // The developer's.
            route("GET", "/api/detect/stream"),
            route("GET", "/api/classify"),
            route("GET", "/api/picks"),
            route("POST", "/api/picks"),
            route("DELETE", "/api/picks"),
            route("GET", "/api/model-comparison"),
            route("GET", "/api/status"),
            route("POST", "/api/retrain"),
            route("POST", "/api/charts/refresh"),
            route("GET", "/api/dev/services"),
            route("POST", "/api/dev/services/{service}/start"));

    static boolean isForwarded(String method, String upstreamPath) {
        PathContainer path = PathContainer.parsePath(upstreamPath);
        return ROUTES.stream().anyMatch(route -> route.matches(method, path));
    }

    private final StreamingProxy proxy;
    private final String plannerBaseUrl;

    public PlannerProxyController(
            StreamingProxy proxy,
            @Value("${planner-service.base-url:http://planning-service:8000}") String plannerBaseUrl) {
        this.proxy = proxy;
        this.plannerBaseUrl = plannerBaseUrl.replaceAll("/+$", "");
    }

    @Operation(summary = "Any planner GET",
            description = "course, detect/stream, classify, picks, checkpoints, navlog, routes, build status")
    @GetMapping("/**")
    public ResponseEntity<StreamingResponseBody> get(HttpServletRequest request) {
        return forward(request, "GET", null);
    }

    @Operation(summary = "Any planner POST", description = "picks, build")
    @PostMapping("/**")
    public ResponseEntity<StreamingResponseBody> post(HttpServletRequest request,
                                                      @RequestBody(required = false) String body) {
        return forward(request, "POST", body);
    }

    @Operation(summary = "Any planner DELETE", description = "picks")
    @DeleteMapping("/**")
    public ResponseEntity<StreamingResponseBody> delete(HttpServletRequest request) {
        return forward(request, "DELETE", null);
    }

    private ResponseEntity<StreamingResponseBody> forward(HttpServletRequest request, String method, String body) {
        String path = upstreamPath(request);
        if (!isForwarded(method, path)) {
            return StreamingProxy.error(404, "no such planner endpoint: " + method + " " + path);
        }
        URI target = URI.create(plannerBaseUrl + path + query(request));

        HttpRequest.BodyPublisher publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8);
        HttpRequest upstream = HttpRequest.newBuilder(target)
                .method(method, publisher)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .timeout(TIMEOUT)
                .build();

        return proxy.exchange(PLANNER, upstream, response -> {
            ResponseEntity.BodyBuilder builder = StreamingProxy.unbuffered(
                    ResponseEntity.status(response.statusCode())
                            .header(HttpHeaders.CONTENT_TYPE, StreamingProxy.contentTypeOf(response)));
            // Forwarded for the chart-tile endpoints only: their
            // `public, max-age=...` is what lets the browser (and any CDN
            // in front of this app) skip asking again for a tile it
            // already has, rather than round-tripping here just to get
            // told "same as before" on every pan/zoom. Every other route
            // under /api/planner/** (course, detect/stream, picks, build,
            // navlog, ...) depends on saved state or a request body, so a
            // Cache-Control it happened to emit must not be echoed the
            // same way.
            if (isTilePath(path)) {
                response.headers().firstValue(HttpHeaders.CACHE_CONTROL)
                        .ifPresent(value -> builder.header(HttpHeaders.CACHE_CONTROL, value));
            }
            return builder.body(StreamingProxy.pipe(response.body()));
        });
    }

    private static boolean isTilePath(String path) {
        for (String prefix : TILE_PATHS) {
            if (path.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /** {@code /api/planner/course} upstream is {@code /api/course}. */
    private static String upstreamPath(HttpServletRequest request) {
        return "/api" + request.getRequestURI().substring("/api/planner".length());
    }

    private static String query(HttpServletRequest request) {
        String queryString = request.getQueryString();
        return queryString == null ? "" : "?" + queryString;
    }
}
