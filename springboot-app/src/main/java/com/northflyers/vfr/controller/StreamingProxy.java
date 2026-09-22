package com.northflyers.vfr.controller;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * The one HTTP client and the one piping loop behind every service this
 * app proxies: the planner ({@link PlannerProxyController}) and the two
 * narrative agents ({@link ComparisonProxyController}).
 *
 * <p>Both proxies were written separately and arrived at the same four
 * things, which is why they are here once. Each is load-bearing:
 *
 * <ul>
 *   <li><b>HTTP/1.1, pinned.</b> The JDK client defaults to attempting an
 *       HTTP/2 upgrade, and every service behind this one is uvicorn,
 *       which speaks HTTP/1.1 only. Left on the default, a pooled
 *       connection that had attempted an upgrade could corrupt a later
 *       request on the same connection -- observed as uvicorn logging
 *       "Unsupported upgrade request" and then "Invalid HTTP request
 *       received" for the very next POST, which FastAPI saw as a request
 *       with no body at all.
 *   <li><b>A flush per chunk.</b> Detection streams newline-delimited
 *       JSON a tile block at a time, and a narrative arrives a sentence
 *       at a time. Without the flush the servlet container fills its own
 *       buffer before writing anything, and a response whose whole value
 *       is that it arrives in pieces arrives in one.
 *   <li><b>Redirects never followed.</b> A redirect from an upstream is
 *       a misconfiguration to surface, not to chase.
 *   <li><b>One error shape.</b> An upstream that does not answer becomes
 *       a 502, one that is interrupted a 504, both with a
 *       {@code {"detail": ...}} body -- the shape the front end's own
 *       stream reader already reports.
 * </ul>
 */
@Component
public class StreamingProxy {

    private static final Logger log = LoggerFactory.getLogger(StreamingProxy.class);

    /** What a caller needs in order to say which upstream went missing.
     *  The wording differs between them ("planner service unreachable"
     *  against "the langgraph agent is unreachable") and reaches a
     *  pilot, so each caller supplies its own rather than sharing one. */
    public record Upstream(String name, String unreachableDetail, String timedOutDetail) {}

    /** Turns an upstream response into this app's, once there is one to
     *  turn: the callers differ in which headers they carry over. */
    @FunctionalInterface
    public interface ResponseShaper extends Function<HttpResponse<InputStream>, ResponseEntity<StreamingResponseBody>> {}

    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    /**
     * Sends {@code request}, and hands the response to {@code onResponse}
     * with its body still unread, so it can be piped rather than
     * buffered. An upstream that cannot be reached never reaches
     * {@code onResponse} at all.
     */
    public ResponseEntity<StreamingResponseBody> exchange(
            Upstream upstream, HttpRequest request, ResponseShaper onResponse) {
        try {
            return onResponse.apply(http.send(request, HttpResponse.BodyHandlers.ofInputStream()));
        } catch (IOException err) {
            log.warn("{} unreachable at {}: {}", upstream.name(), request.uri(), err.toString());
            return error(502, upstream.unreachableDetail());
        } catch (InterruptedException err) {
            Thread.currentThread().interrupt();
            return error(504, upstream.timedOutDetail());
        }
    }

    /** A {@code {"detail": ...}} response, JSON-escaped for quotes and
     *  backslashes: a detail carries an upstream's own name and status. */
    public static ResponseEntity<StreamingResponseBody> error(int status, String detail) {
        String escaped = detail.replace("\\", "\\\\").replace("\"", "\\\"");
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(json("{\"detail\":\"" + escaped + "\"}"));
    }

    /** A fixed JSON body, written and flushed. */
    public static StreamingResponseBody json(String body) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return out -> {
            out.write(bytes);
            out.flush();
        };
    }

    /** Copies upstream to the client, flushing each chunk. */
    public static StreamingResponseBody pipe(InputStream upstreamBody) {
        return out -> copy(upstreamBody, out);
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        try (in) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                out.flush();
            }
        }
    }

    /** The header that keeps an intermediary from buffering a stream this
     *  app has gone to trouble to flush. */
    public static ResponseEntity.BodyBuilder unbuffered(ResponseEntity.BodyBuilder builder) {
        return builder.header("X-Accel-Buffering", "no");
    }

    /** The content type an upstream declared, or JSON if it declared none. */
    public static String contentTypeOf(HttpResponse<InputStream> response) {
        return response.headers().firstValue(HttpHeaders.CONTENT_TYPE)
                .orElse(MediaType.APPLICATION_JSON_VALUE);
    }
}
