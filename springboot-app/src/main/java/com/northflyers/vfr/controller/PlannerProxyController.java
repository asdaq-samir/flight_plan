package com.northflyers.vfr.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

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
