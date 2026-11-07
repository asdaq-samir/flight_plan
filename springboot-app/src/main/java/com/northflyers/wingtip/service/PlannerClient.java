package com.northflyers.wingtip.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.util.RawValue;
import com.northflyers.wingtip.planner.model.PlannerChangesWords;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

/**
 * The planner, asked by this app on its own behalf rather than for a
 * browser's request (that is {@link com.northflyers.wingtip.controller.PlannerProxyController}):
 * a flight's briefing, and what changed between two briefings in words,
 * for the flight watch (FlightWatchService). Reached at the same base
 * address the proxy and AccountService use.
 *
 * <p>The briefing is the planner's JSON document, carried as a string
 * and never read inside: what it says is the planner's to say, and the
 * gateway only keeps it to hand back. The client is pinned to HTTP/1.1
 * for the reason {@link com.northflyers.wingtip.controller.StreamingProxy}
 * gives: the planner is uvicorn, and a pooled connection that attempted
 * an HTTP/2 upgrade corrupted the next request on it.
 */
@Component
public class PlannerClient {

    /** A briefing reads the weather along the route, tens of seconds when
     *  aviationweather.gov is slow; the words are one Claude call. */
    private static final Duration TIMEOUT = Duration.ofMinutes(2);

    /** Fields the planner adds later are ignored: its answers are
     *  generated from its OpenAPI document as this app was built, and a
     *  planner deployed after it may say more. */
    static final ObjectMapper JSON = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /** The planner did not answer, or not with what was asked for. */
    public static class Unavailable extends RuntimeException {
        public Unavailable(String why) {
            super(why);
        }

        public Unavailable(String why, Throwable cause) {
            super(why, cause);
        }
    }

    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private final String plannerBaseUrl;

    public PlannerClient(@Value("${planner-service.base-url:http://planning-service:8000}") String plannerBaseUrl) {
        this.plannerBaseUrl = plannerBaseUrl.replaceAll("/+$", "");
    }

    /**
     * The flight's briefing now, as the planner writes it (GET
     * /api/briefing), for the departure time and the flight's own time
     * en route, so the forecast covers the flight.
     *
     * @throws Unavailable when the planner cannot be reached or refuses
     */
    public String briefing(String dep, String dest, List<String> stops, Instant depart, Double eteMin) {
        StringBuilder query = new StringBuilder("?dep=").append(encode(dep)).append("&dest=").append(encode(dest));
        if (stops != null && !stops.isEmpty()) {
            query.append("&stops=").append(encode(String.join(",", stops)));
        }
        query.append("&depart=").append(encode(DateTimeFormatter.ISO_INSTANT.format(depart)));
        if (eteMin != null) {
            query.append("&ete_min=").append(eteMin);
        }
        HttpRequest request = HttpRequest.newBuilder(URI.create(plannerBaseUrl + "/api/briefing" + query))
                .GET()
                .timeout(TIMEOUT)
                .build();
        return send(request, "the briefing");
    }

    /**
     * What changed between two briefings of the flight, in words (POST
     * /api/words/changes): whether anything did, the sentences that say
     * what, the reports they came from, and which model wrote them;
     * {@code unavailable} says why there are none when the words could
     * not be written. The answer is the planner's own ChangesWords,
     * generated from planning-service/openapi.json at build time (the
     * pom's openapi-generator-maven-plugin). Both briefings go as the
     * JSON they came as, which is why the ask is built here rather than
     * from the generated ChangesAsk: that would parse two whole briefings
     * only to write them out again.
     *
     * @throws Unavailable when the planner cannot be reached, refuses, or
     *     answers something that is not its answer
     */
    public PlannerChangesWords changes(String dep, String dest, List<String> stops, String then, String now) {
        ObjectNode body = JSON.createObjectNode();
        body.put("dep", dep);
        body.put("dest", dest);
        ArrayNode stopNodes = body.putArray("stops");
        for (String stop : stops == null ? List.<String>of() : stops) {
            stopNodes.add(stop);
        }
        // Embedded as the JSON they already are, not as strings holding JSON.
        body.putRawValue("then", new RawValue(then));
        body.putRawValue("now", new RawValue(now));
        HttpRequest request = HttpRequest.newBuilder(URI.create(plannerBaseUrl + "/api/words/changes"))
                .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .timeout(TIMEOUT)
                .build();
        String answer = send(request, "the changes");
        try {
            return JSON.readValue(answer, PlannerChangesWords.class);
        } catch (JsonProcessingException notItsAnswer) {
            throw new Unavailable("the planner's answer to the changes was not its answer", notItsAnswer);
        }
    }

    private String send(HttpRequest request, String what) {
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) {
                throw new Unavailable("the planner answered " + response.statusCode() + " to " + what);
            }
            return response.body();
        } catch (IOException failed) {
            throw new Unavailable("the planner could not be reached for " + what, failed);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new Unavailable("interrupted asking the planner for " + what, interrupted);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
