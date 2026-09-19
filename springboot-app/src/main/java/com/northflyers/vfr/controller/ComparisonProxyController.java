package com.northflyers.vfr.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Brief tab's own AI popover calls this, one framework at a time
 * (LangGraph or CrewAI tab, {@code framework=langgraph}/{@code
 * framework=crewai}): runs nav-log-agent's LangGraph build and/or
 * crewai-agent's CrewAI build on an identical route and returns the
 * result, so the comparison the two services exist to make (see
 * crewai-agent/app/main.py's own module docstring) is actually
 * visible somewhere instead of terminal-only. {@code framework}
 * omitted runs both at once (no current caller in the UI -- this used
 * to be Settings' own Agent Framework Comparison panel's own mode,
 * dropped as redundant once the Brief tab's own popover offered the
 * same choice in context -- but the capability itself stays, a
 * generic "compare both" is a reasonable thing for this endpoint to
 * still support).
 *
 * <p>Neither call is required for the other to succeed, and neither is
 * required for this controller (or webapp generally) to be usable --
 * unlike {@link PlannerProxyController}, a real request-path dependency,
 * these two are a developer-facing extra. A framework being down, slow,
 * or erroring reports as {@code {"error": "..."}} for that framework
 * alone, same shape both services already use for their own per-source
 * failures (vfr.altitude's weather_unavailable, /api/briefing's own).
 */
@RestController
@RequestMapping("/api/comparison")
@Tag(name = "Comparison", description = "LangGraph vs CrewAI, same route -- the Brief tab's own AI popover")
public class ComparisonProxyController {

    private static final Logger log = LoggerFactory.getLogger(ComparisonProxyController.class);

    // Both calls run a full agent loop (checkpoints -> altitude -> legs
    // -> a real Claude call), tens of seconds each -- long enough that
    // this needs its own generous timeout, the same reasoning as
    // PlannerProxyController's.
    private static final Duration TIMEOUT = Duration.ofMinutes(5);

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private final String navLogAgentBaseUrl;
    private final String navLogAgentApiKey;
    private final String crewaiAgentBaseUrl;

    public ComparisonProxyController(
            @Value("${nav-log-agent.base-url}") String navLogAgentBaseUrl,
            @Value("${nav-log-agent.api-key}") String navLogAgentApiKey,
            @Value("${crewai-agent.base-url}") String crewaiAgentBaseUrl) {
        this.navLogAgentBaseUrl = navLogAgentBaseUrl.replaceAll("/+$", "");
        this.navLogAgentApiKey = navLogAgentApiKey;
        this.crewaiAgentBaseUrl = crewaiAgentBaseUrl.replaceAll("/+$", "");
    }

    @Operation(summary = "Run the same route through one or both agent frameworks",
            description = "Each requested framework's result, or {\"error\": \"...\"} for that framework alone if it's down/erroring. "
                    + "framework=langgraph or framework=crewai runs one only (the Brief tab's own AI popover, LangGraph/CrewAI tabs "
                    + "inside it, each a real billed Claude call -- a pilot picking one shouldn't pay for the other); omitted runs "
                    + "both (no current UI caller for that mode).")
    @GetMapping
    public ResponseEntity<String> compare(
            @RequestParam String dep, @RequestParam String dest,
            @RequestParam(defaultValue = "c172") String aircraft,
            @RequestParam(required = false) String framework) {
        String query = "departure_ident=" + encode(dep) + "&destination_ident=" + encode(dest)
                + "&aircraft_name=" + encode(aircraft);

        CompletableFuture<String> langgraph = framework == null || "langgraph".equals(framework)
                ? CompletableFuture.supplyAsync(() -> fetch(navLogAgentBaseUrl + "/compare?" + query, navLogAgentApiKey))
                : null;
        CompletableFuture<String> crewai = framework == null || "crewai".equals(framework)
                ? CompletableFuture.supplyAsync(() -> fetch(crewaiAgentBaseUrl + "/compare?" + query, null))
                : null;

        StringBuilder body = new StringBuilder("{");
        if (langgraph != null) {
            body.append("\"langgraph\":").append(langgraph.join());
        }
        if (crewai != null) {
            if (langgraph != null) body.append(",");
            body.append("\"crewai\":").append(crewai.join());
        }
        body.append("}");
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body.toString());
    }

    /** Raw JSON on success (passed through, not re-parsed -- this
     *  controller never inspects the shape either framework returns, it
     *  just relays it), or a {@code {"error": "..."}} object on any
     *  failure -- always valid JSON either way, since it's spliced
     *  straight into the combined response body above. */
    private String fetch(String url, String bearerToken) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .GET().timeout(TIMEOUT);
        if (bearerToken != null && !bearerToken.isBlank()) {
            builder.header("Authorization", "Bearer " + bearerToken);
        }
        try {
            HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.warn("comparison call to {} returned {}", url, response.statusCode());
                return "{\"error\":" + jsonString("upstream returned " + response.statusCode()) + "}";
            }
            return response.body();
        } catch (IOException err) {
            log.warn("comparison call to {} failed: {}", url, err.toString());
            return "{\"error\":" + jsonString("unreachable: " + err.getMessage()) + "}";
        } catch (InterruptedException err) {
            Thread.currentThread().interrupt();
            return "{\"error\":" + jsonString("interrupted") + "}";
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String jsonString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
