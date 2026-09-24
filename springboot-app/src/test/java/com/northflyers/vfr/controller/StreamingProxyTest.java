package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/** An upstream that answers too slowly is a 504 that says so, not a 502
 *  "unreachable": the timeout is an IOException too, and was caught as
 *  one. */
class StreamingProxyTest {

    private static final StreamingProxy.Upstream PLANNER = new StreamingProxy.Upstream(
            "planner service", "planner service unreachable", "planner service timed out");

    private HttpServer slow;

    @AfterEach
    void stop() {
        if (slow != null) {
            slow.stop(0);
        }
    }

    @Test
    void anUpstreamThatTakesTooLongIsA504() throws Exception {
        slow = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        slow.createContext("/", exchange -> {
            try {
                Thread.sleep(2000);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        slow.start();
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + slow.getAddress().getPort() + "/api/course"))
                .timeout(Duration.ofMillis(200))
                .build();

        ResponseEntity<StreamingResponseBody> answer = new StreamingProxy().exchange(
                PLANNER, request, response -> ResponseEntity.ok().build());

        assertThat(answer.getStatusCode().value()).isEqualTo(504);
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        answer.getBody().writeTo(body);
        assertThat(body.toString(StandardCharsets.UTF_8)).contains("planner service timed out");
    }
}
