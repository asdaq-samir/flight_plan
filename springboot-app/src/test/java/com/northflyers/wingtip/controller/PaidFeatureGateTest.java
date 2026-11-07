package com.northflyers.wingtip.controller;

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

import com.northflyers.wingtip.domain.PaidFeature;
import com.northflyers.wingtip.service.PilotService;
import com.northflyers.wingtip.service.SubscriptionService;
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
 * The paid features Claude writes are refused, before the planner is
 * asked, with the subscription's own answer -- a 402 without
 * one, a 429 past the month's cap -- and its sentence; what is free (a
 * pilot's own note saved) is never checked. The upstreams point nowhere:
 * a call that got past the gate would be a 502.
 */
@WebMvcTest(PlannerProxyController.class)
@Import(StreamingProxy.class)
@AutoConfigureMockMvc(addFilters = false)
@TestPropertySource(properties = {
        // A deployment that sells the subscription, whose gate these are.
        "app.subscription.enabled=true",
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
        finish(post("/api/planner/briefing/narrative")
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

    /** The assistant is Opus with up to eight tool rounds an ask: the
     *  gate's answer, with app.claude-features OFF a 404, stops it. */
    @Test
    void theAssistantIsGatedLikeTheOtherClaudeFeatures() throws Exception {
        refuse(PaidFeature.ASSISTANT, 404, "The assistant comes later; it is not offered yet.");
        finish(post("/api/planner/assistant").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("The assistant comes later; it is not offered yet."));
    }

    /** Every kind of reading in words is the one feature, matched by its
     *  path's pattern. */
    @Test
    void everyKindOfReadingInWordsIsGated() throws Exception {
        refuse(PaidFeature.WORDS, 402, "The readings in words come with the subscription.");
        for (String kind : new String[] {"notams", "weather", "risk", "debrief", "changes"}) {
            finish(post("/api/planner/words/" + kind).contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isPaymentRequired())
                    .andExpect(jsonPath("$.detail").value("The readings in words come with the subscription."));
        }
    }

    @Test
    void theWordsPathsAreOneFeatureAndNothingElseIs() {
        org.assertj.core.api.Assertions.assertThat(PlannerProxyController.paidFeatureOf("/api/words/weather"))
                .isEqualTo(PaidFeature.WORDS);
        org.assertj.core.api.Assertions.assertThat(PlannerProxyController.paidFeatureOf("/api/assistant"))
                .isEqualTo(PaidFeature.ASSISTANT);
        org.assertj.core.api.Assertions.assertThat(PlannerProxyController.paidFeatureOf("/api/words")).isNull();
        org.assertj.core.api.Assertions.assertThat(PlannerProxyController.paidFeatureOf("/api/go-no-go")).isNull();
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
