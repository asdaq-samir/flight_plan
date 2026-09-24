package com.northflyers.vfr.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * The flight planning drawer's narrative popover streams its narrative through this, one
 * framework at a time ({@code framework=langgraph} runs nav-log-agent's
 * LangGraph build, {@code framework=crewai} crewai-agent's CrewAI build):
 * the comparison the two services exist to make (see crewai-agent/app/
 * main.py's own module docstring) is visible somewhere instead of
 * terminal-only, and a pilot picking one framework does not pay for the
 * other.
 *
 * <p>The body is the nav log the page already shows -- idents, aircraft,
 * cruise altitude and its selection, the legs -- forwarded as-is. Both
 * agents write about those numbers rather than recomputing them (they
 * used to: model-service, terrain, airspace and winds all over again,
 * and a pilot's own altitude override was silently ignored), and both
 * answer with newline-delimited JSON as Claude writes: {@code delta}
 * lines carrying text, then {@code done} or {@code error}. Piped, not
 * buffered, by {@link StreamingProxy}, for the same reason the planner's
 * responses are: the point of the stream is that the first sentence
 * arrives in a second or two rather than the whole briefing after ten.
 *
 * <p>Neither agent is required for webapp to be usable -- unlike
 * {@link PlannerProxyController}, a real request-path dependency, this
 * is a developer-facing extra. An agent that is down answers as a 502
 * with a {@code {"detail": ...}} body, the shape the front end's own
 * stream reader already reports. An agent that answers but refuses
 * carries its own {@code detail} through: a 422 (the nav log it was sent
 * was not one) as a 422, anything else as a 502 naming the agent's own
 * reason rather than only its status.
 */
@RestController
@RequestMapping("/api/comparison")
@Tag(name = "Comparison", description = "LangGraph vs CrewAI, same nav log -- the flight planning drawer's narrative popover")
public class ComparisonProxyController {

    private static final Logger log = LoggerFactory.getLogger(ComparisonProxyController.class);

    /** A narrative is one Claude call now, tens of seconds at most; the
     *  margin is for a cold agent, not for the call. */
    private static final Duration TIMEOUT = Duration.ofMinutes(5);

    private static final ObjectMapper JSON = new ObjectMapper();

    /** An error body is a sentence or two; this is only a bound on what
     *  gets read, not a size anything is expected to reach. */
    private static final int ERROR_BODY_LIMIT = 16 * 1024;

    /** The largest nav log forwarded to an agent. A long cross-country
     *  with every leg field is a few tens of KB; the agents also refuse
     *  more than vfr.narrative.MAX_LEGS legs. */
    static final int BODY_LIMIT = 256 * 1024;

    private final StreamingProxy proxy;
    private final String navLogAgentBaseUrl;
    private final String navLogAgentApiKey;
    private final String crewaiAgentBaseUrl;

    public ComparisonProxyController(
            StreamingProxy proxy,
            @Value("${nav-log-agent.base-url}") String navLogAgentBaseUrl,
            @Value("${nav-log-agent.api-key}") String navLogAgentApiKey,
            @Value("${crewai-agent.base-url}") String crewaiAgentBaseUrl) {
        this.proxy = proxy;
        this.navLogAgentBaseUrl = navLogAgentBaseUrl.replaceAll("/+$", "");
        this.navLogAgentApiKey = navLogAgentApiKey;
        this.crewaiAgentBaseUrl = crewaiAgentBaseUrl.replaceAll("/+$", "");
    }

    @Operation(summary = "Stream one framework's narrative for the nav log in the body",
            description = "framework=langgraph (nav-log-agent) or framework=crewai (crewai-agent), each a real billed "
                    + "Claude call. The body is the nav log the flight planning drawer shows (departure_ident, destination_ident, "
                    + "aircraft_name, altitude_ft, altitude_selection, legs); the response is newline-delimited JSON: "
                    + "delta lines with text as it is written, then a done line with the whole briefing, or an error line.")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
            content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE, schema = @Schema(type = "string")))
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StreamingResponseBody> narrative(
            @RequestParam String framework, HttpServletRequest request) throws IOException {
        // Read up to the limit and no further: every byte here is prompt
        // text a billed Claude call reads, and a String @RequestBody would
        // have read all of it before this method could look.
        byte[] body = request.getInputStream().readNBytes(BODY_LIMIT + 1);
        if (body.length > BODY_LIMIT) {
            return StreamingProxy.error(413, "a nav log is at most " + (BODY_LIMIT / 1024) + " KB");
        }
        String navLog = new String(body, StandardCharsets.UTF_8);
        String baseUrl;
        String bearerToken = null;
        if ("langgraph".equals(framework)) {
            baseUrl = navLogAgentBaseUrl;
            bearerToken = navLogAgentApiKey;
        } else if ("crewai".equals(framework)) {
            baseUrl = crewaiAgentBaseUrl;
        } else {
            return StreamingProxy.error(400, "framework must be langgraph or crewai");
        }

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + "/compare"))
                .POST(HttpRequest.BodyPublishers.ofString(navLog, StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .timeout(TIMEOUT);
        if (bearerToken != null && !bearerToken.isBlank()) {
            builder.header(HttpHeaders.AUTHORIZATION, "Bearer " + bearerToken);
        }

        StreamingProxy.Upstream agent = new StreamingProxy.Upstream(
                framework + " agent",
                "the " + framework + " agent is unreachable",
                "the " + framework + " agent timed out");
        String upstreamUrl = baseUrl;
        return proxy.exchange(agent, builder.build(), response -> {
            if (response.statusCode() != 200) {
                String detail = detailOf(response.body());
                log.warn("{} agent at {} returned {}: {}", framework, upstreamUrl, response.statusCode(), detail);
                // A 422 is the agent refusing the nav log it was sent,
                // which is the caller's to fix, so it goes back as one.
                // Anything else is the agent's own failure: a 502 either
                // way, but with the agent's reason where it gave one.
                int status = response.statusCode() == 422 ? 422 : 502;
                return StreamingProxy.error(status, detail == null
                        ? "the " + framework + " agent returned " + response.statusCode()
                        : "the " + framework + " agent: " + detail);
            }
            return StreamingProxy.unbuffered(
                    ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/x-ndjson"))
                    .body(StreamingProxy.pipe(response.body()));
        });
    }

    /** The agent's own {@code detail}, when its error body is the
     *  {@code {"detail": "..."}} shape both agents send; null otherwise.
     *  Reads the rest of the body off the connection either way, so it
     *  can go back in the pool. */
    private static String detailOf(InputStream body) {
        try (body) {
            byte[] head = body.readNBytes(ERROR_BODY_LIMIT);
            body.transferTo(OutputStream.nullOutputStream());
            JsonNode detail = JSON.readTree(head).path("detail");
            return detail.isTextual() && !detail.asText().isBlank() ? detail.asText() : null;
        } catch (IOException notJson) {
            return null;
        }
    }
}
