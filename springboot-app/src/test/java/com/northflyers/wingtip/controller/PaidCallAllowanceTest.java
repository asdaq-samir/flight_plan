package com.northflyers.wingtip.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.wingtip.service.PilotService;
import com.northflyers.wingtip.service.SubscriptionService;
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
 * The calls this app pays Anthropic for -- the Brief's narrative, and
 * generating a route's checkpoint notes -- have a daily allowance per
 * pilot, and past it the answer is a 429 that says so before anything
 * is asked of the planner. A day of none here (per-day 0),
 * so the first ask is already past it; the upstreams point nowhere.
 */
@WebMvcTest(PlannerProxyController.class)
@Import(StreamingProxy.class)
@AutoConfigureMockMvc(addFilters = false)
@TestPropertySource(properties = {
        // A deployment that sells the subscription, whose gate these are.
        "app.subscription.enabled=true",
        "app.paid-calls.per-day=0",
        "planner-service.base-url=http://127.0.0.1:9",
})
class PaidCallAllowanceTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilots;

    @MockitoBean
    private SubscriptionService subscriptions;

    @Test
    void aNarrativePastTheDaysAllowanceIsA429ThatSaysSo() throws Exception {
        finish(post("/api/planner/briefing/narrative")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departure_ident\":\"C81\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("AI narratives")));
    }

    /** Every byte of a nav log is prompt text a billed Claude call
     *  reads: one past the limit is refused before the day's allowance
     *  or the planner is asked. */
    @Test
    void aNavLogPastTheLimitIsA413() throws Exception {
        String huge = "{\"legs\":\"" + "x".repeat(PlannerProxyController.NARRATIVE_BODY_LIMIT) + "\"}";
        finish(post("/api/planner/briefing/narrative")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(huge))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.detail").value("a nav log is at most 256 KB"));
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
