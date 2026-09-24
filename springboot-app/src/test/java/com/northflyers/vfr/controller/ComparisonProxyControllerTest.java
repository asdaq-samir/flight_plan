package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The narrative proxy, against a real upstream standing in for both
 * agents -- for the same reason {@link PlannerProxyControllerTest} uses
 * one: what is under test is HTTP, a status and a body passed on or not.
 */
@WebMvcTest(ComparisonProxyController.class)
@Import(StreamingProxy.class)
@AutoConfigureMockMvc(addFilters = false)
class ComparisonProxyControllerTest {

    private static HttpServer upstream;
    private static final List<String> received = new CopyOnWriteArrayList<>();
    private static volatile int responseStatus = 200;
    private static volatile String responseBody = "";

    @Autowired
    private MockMvc mockMvc;

    @BeforeAll
    static void startUpstream() throws IOException {
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/", exchange -> {
            received.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath()
                    + " auth=" + exchange.getRequestHeaders().getFirst("Authorization"));
            exchange.getRequestBody().readAllBytes();
            byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(responseStatus, body.length == 0 ? -1 : body.length);
            if (body.length > 0) {
                exchange.getResponseBody().write(body);
            }
            exchange.close();
        });
        upstream.start();
    }

    @AfterAll
    static void stopUpstream() {
        upstream.stop(0);
    }

    @DynamicPropertySource
    static void agentUrls(DynamicPropertyRegistry registry) {
        String url = "http://127.0.0.1:" + upstream.getAddress().getPort();
        registry.add("nav-log-agent.base-url", () -> url);
        registry.add("nav-log-agent.api-key", () -> "test-key");
        registry.add("crewai-agent.base-url", () -> url);
    }

    @BeforeEach
    void reset() {
        received.clear();
        responseStatus = 200;
        responseBody = "";
    }

    private MvcResult narrative(String framework) throws Exception {
        MvcResult started = mockMvc.perform(post("/api/comparison?framework=" + framework)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departure_ident\":\"C81\"}"))
                .andExpect(request().asyncStarted())
                .andReturn();
        return started;
    }

    @Test
    void aStreamIsPipedFromTheChosenAgentWithItsOwnToken() throws Exception {
        responseBody = "{\"type\":\"done\",\"briefing\":\"Depart runway 27.\"}\n";
        MvcResult started = narrative("langgraph");

        mockMvc.perform(asyncDispatch(started))
                .andExpect(status().isOk())
                .andExpect(content().string(responseBody));
        assertThat(received).containsExactly("POST /compare auth=Bearer test-key");
    }

    @Test
    void anAgentRefusingTheNavLogIsPassedOnAsA422WithItsReason() throws Exception {
        responseStatus = 422;
        responseBody = "{\"detail\":\"invalid nav log: legs: Field required\"}";
        MvcResult started = narrative("langgraph");

        mockMvc.perform(asyncDispatch(started))
                .andExpect(status().is(422))
                .andExpect(jsonPath("$.detail").value("the langgraph agent: invalid nav log: legs: Field required"));
    }

    @Test
    void anAgentFailingIsA502CarryingItsOwnReason() throws Exception {
        responseStatus = 500;
        responseBody = "{\"detail\":\"Could not reach planning-service\"}";
        MvcResult started = narrative("crewai");

        mockMvc.perform(asyncDispatch(started))
                .andExpect(status().is(502))
                .andExpect(jsonPath("$.detail").value("the crewai agent: Could not reach planning-service"));
        assertThat(received).containsExactly("POST /compare auth=null");
    }

    @Test
    void anAgentFailingWithoutAReasonStillSaysWhichAndHow() throws Exception {
        responseStatus = 500;
        responseBody = "Internal Server Error";
        MvcResult started = narrative("crewai");

        mockMvc.perform(asyncDispatch(started))
                .andExpect(status().is(502))
                .andExpect(jsonPath("$.detail").value("the crewai agent returned 500"));
    }

    /** Every byte forwarded is prompt text a billed call reads, so an
     *  oversized body is refused here and never reaches an agent. */
    @Test
    void aBodyOverTheLimitIsA413AndNeverReachesAnAgent() throws Exception {
        String huge = "{\"legs\":\"" + "x".repeat(ComparisonProxyController.BODY_LIMIT) + "\"}";
        mockMvc.perform(post("/api/comparison?framework=crewai")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(huge))
                .andExpect(status().is(413));
        assertThat(received).isEmpty();
    }
}
