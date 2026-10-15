package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.PaidFeature;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.SubscriptionService;
import java.util.Optional;
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
 * The paid features Claude writes are refused, before any agent or the
 * planner is asked, with the subscription's own answer -- a 402 without
 * one, a 429 past the month's cap -- and its sentence; what is free (a
 * pilot's own note saved) is never checked. The upstreams point nowhere:
 * a call that got past the gate would be a 502.
 */
@WebMvcTest({ComparisonProxyController.class, PlannerProxyController.class})
@Import(StreamingProxy.class)
@AutoConfigureMockMvc(addFilters = false)
@TestPropertySource(properties = {
        // A deployment that sells the subscription, whose gate these are.
        "app.subscription.enabled=true",
        "nav-log-agent.base-url=http://127.0.0.1:9",
        "nav-log-agent.api-key=test-key",
        "crewai-agent.base-url=http://127.0.0.1:9",
        "planner-service.base-url=http://127.0.0.1:9",
})
class PaidFeatureGateTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilots;

    @MockitoBean
    private SubscriptionService subscriptions;

    private void refuse(PaidFeature feature, int status, String detail) {
        given(subscriptions.refusal(any(), eq(feature)))
                .willReturn(Optional.of(new SubscriptionService.Refusal(status, detail)));
    }

    @Test
    void theWrittenBriefingWithoutTheSubscriptionIsA402ThatSaysSo() throws Exception {
        refuse(PaidFeature.NARRATIVE, 402, "The written briefing comes with the subscription, its first month free.");
        finish(post("/api/comparison?framework=langgraph")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departure_ident\":\"C81\"}"))
                .andExpect(status().isPaymentRequired())
                .andExpect(jsonPath("$.detail").value("The written briefing comes with the subscription, its first month free."));
    }

    @Test
    void checkpointDescriptionsWithoutTheSubscriptionAreA402() throws Exception {
        refuse(PaidFeature.CHECKPOINT_NOTES, 402, "Checkpoint descriptions come with the subscription.");
        finish(post("/api/planner/checkpoint-notes/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departure_ident\":\"C81\",\"destination_ident\":\"KDLH\"}"))
                .andExpect(status().isPaymentRequired())
                .andExpect(jsonPath("$.detail").value("Checkpoint descriptions come with the subscription."));
    }

    @Test
    void theMockOralPastTheMonthsCapIsA429() throws Exception {
        refuse(PaidFeature.ORAL, 429, "That is this month's 60 mock-oral questions and grades. More on 1 November.");
        for (String path : new String[] {"/api/planner/oral/question", "/api/planner/oral/grade"}) {
            finish(post(path).contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isTooManyRequests())
                    .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.startsWith("That is this month's 60")));
        }
    }

    @Test
    void aPilotsOwnNoteIsFreeAndNeverChecked() throws Exception {
        refuse(PaidFeature.CHECKPOINT_NOTES, 402, "Checkpoint descriptions come with the subscription.");
        finish(post("/api/planner/checkpoint-notes").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadGateway());
        verify(subscriptions, never()).refusal(any(), any());
    }

    /** See PaidCallAllowanceTest: the answer is written on another thread. */
    private ResultActions finish(RequestBuilder call) throws Exception {
        MvcResult started = mockMvc.perform(call).andExpect(request().asyncStarted()).andReturn();
        return mockMvc.perform(asyncDispatch(started));
    }
}
