package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.service.PilotService;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The calls this app pays Anthropic for -- a framework narrative, and
 * generating a route's checkpoint notes -- have a daily allowance per
 * pilot, and past it the answer is a 429 that says so before anything
 * is asked of an agent or the planner. A day of none here (per-day 0),
 * so the first ask is already past it; the upstreams point nowhere.
 */
@WebMvcTest({ComparisonProxyController.class, PlannerProxyController.class})
@Import(StreamingProxy.class)
@AutoConfigureMockMvc(addFilters = false)
@TestPropertySource(properties = {
        "app.paid-calls.per-day=0",
        "nav-log-agent.base-url=http://127.0.0.1:9",
        "nav-log-agent.api-key=test-key",
        "crewai-agent.base-url=http://127.0.0.1:9",
        "planner-service.base-url=http://127.0.0.1:9",
})
class PaidCallAllowanceTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilots;

    @Test
    void aNarrativePastTheDaysAllowanceIsA429ThatSaysSo() throws Exception {
        finish(post("/api/comparison?framework=langgraph")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departure_ident\":\"C81\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("AI narratives")));
    }

    @Test
    void generatingNotesPastTheDaysAllowanceIsA429ThatSaysSo() throws Exception {
        finish(post("/api/planner/checkpoint-notes/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departure_ident\":\"C81\",\"destination_ident\":\"KDLH\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("checkpoint-note generations")));
    }

    /** Saving a pilot's own note costs nothing, so it is not counted: it
     *  goes on to the planner, which is not there (a 502), where a
     *  counted call would have stopped at the 429. */
    @Test
    void savingANoteIsNotCounted() throws Exception {
        finish(post("/api/planner/checkpoint-notes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadGateway());
    }

    @Test
    void theWindowSlides() {
        SlidingWindowLimiter limiter = new SlidingWindowLimiter(Duration.ofDays(1));
        Instant morning = Instant.parse("2026-09-28T08:00:00Z");
        assertThat(limiter.allow("user:a", 2, morning)).isTrue();
        assertThat(limiter.allow("user:a", 2, morning.plusSeconds(60))).isTrue();
        assertThat(limiter.allow("user:a", 2, morning.plusSeconds(120))).isFalse();
        assertThat(limiter.allow("user:b", 2, morning.plusSeconds(120))).isTrue();
        assertThat(limiter.allow("user:a", 2, morning.plus(Duration.ofDays(1)).plusSeconds(1))).isTrue();
    }

    /** Every answer here, a 429 included, is a StreamingResponseBody,
     *  written on another thread: its status and body are only there
     *  once the async dispatch has run. Read before it, the body can be
     *  empty -- as it was on CI's runner, never locally. */
    private ResultActions finish(RequestBuilder call) throws Exception {
        MvcResult started = mockMvc.perform(call).andExpect(request().asyncStarted()).andReturn();
        return mockMvc.perform(asyncDispatch(started));
    }
}
