package com.northflyers.vfr.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 * <p>Responses are piped rather than buffered. Detection streams
 * newline-delimited JSON a tile block at a time so the map fills from the
 * departure end while the rest is still being read; collecting that into
 * a String before forwarding it would turn a progressive response into a
 * five-second wait and undo the reason it was made a stream.
 */
@RestController
@RequestMapping("/api/planner")
@Tag(name = "Planner", description = "Chart vision, course and nav log, proxied from the planner service")
public class PlannerProxyController {

    private static final Logger log = LoggerFactory.getLogger(PlannerProxyController.class);

    /** Long, because a cold corridor read is tens of seconds and a
     *  collection job is minutes. The client is what should give up. */
    private static final Duration TIMEOUT = Duration.ofMinutes(10);

    // HTTP/1.1 pinned deliberately: the JDK client defaults to attempting
    // an HTTP/2 upgrade, and planning-service (uvicorn) speaks HTTP/1.1
    // only. Left on the default, a pooled connection that had negotiated
    // (or attempted) an upgrade could corrupt a later request on the same
    // connection -- observed as uvicorn logging "Unsupported upgrade
    // request" followed by "Invalid HTTP request received" for the very
    // next POST, which FastAPI then saw as a request with no body at all.
    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private final String plannerBaseUrl;

    public PlannerProxyController(@Value("${planner-service.base-url:http://planning-service:8000}") String plannerBaseUrl) {
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
        URI target = URI.create(plannerBaseUrl + upstreamPath(request) + query(request));

        HttpRequest.BodyPublisher publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8);
        HttpRequest upstream = HttpRequest.newBuilder(target)
                .method(method, publisher)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .timeout(TIMEOUT)
                .build();

        HttpResponse<InputStream> response;
        try {
            response = http.send(upstream, HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException err) {
            log.warn("planner service unreachable at {}: {}", target, err.toString());
            return ResponseEntity.status(502)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(jsonBody("{\"detail\":\"planner service unreachable\"}"));
        } catch (InterruptedException err) {
            Thread.currentThread().interrupt();
            return ResponseEntity.status(504)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(jsonBody("{\"detail\":\"planner service timed out\"}"));
        }

        String contentType = response.headers().firstValue(HttpHeaders.CONTENT_TYPE)
                .orElse(MediaType.APPLICATION_JSON_VALUE);
        InputStream upstreamBody = response.body();

        return ResponseEntity.status(response.statusCode())
                .header(HttpHeaders.CONTENT_TYPE, contentType)
                // Flushed per chunk below; announcing it keeps any
                // intermediary from deciding to buffer the stream itself.
                .header("X-Accel-Buffering", "no")
                .body(out -> pipe(upstreamBody, out));
    }

    /**
     * Copies upstream to the client, flushing each chunk.
     *
     * <p>The flush is the whole point. Without it the servlet container
     * fills its own buffer before writing anything, and a response whose
     * value is that it arrives in pieces arrives in one.
     */
    private static void pipe(InputStream in, OutputStream out) throws IOException {
        try (in) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                out.flush();
            }
        }
    }

    /** {@code /api/planner/course} upstream is {@code /api/course}. */
    private static String upstreamPath(HttpServletRequest request) {
        return "/api" + request.getRequestURI().substring("/api/planner".length());
    }

    private static String query(HttpServletRequest request) {
        String queryString = request.getQueryString();
        return queryString == null ? "" : "?" + queryString;
    }

    private static StreamingResponseBody jsonBody(String json) {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        return out -> {
            out.write(bytes);
            out.flush();
        };
    }
}
