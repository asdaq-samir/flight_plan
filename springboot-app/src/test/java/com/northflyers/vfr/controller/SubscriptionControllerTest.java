package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.PaidFeature;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.SubscriptionDto;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.SubscriptionService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The subscription's two calls, pilot-scoped as the flights are: what it
 *  is, and the free month started -- once, a 409 that says so after. */
@WebMvcTest(SubscriptionController.class)
@Import(com.northflyers.vfr.security.SecurityConfig.class)
class SubscriptionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilots;

    @MockitoBean
    private SubscriptionService subscriptions;

    /** A deployment that sells it, unless a test says not. */
    @org.junit.jupiter.api.BeforeEach
    void sold() {
        given(subscriptions.sold()).willReturn(true);
    }


    private static final Pilot PILOT = new Pilot("pilot@example.com", "A. Pilot", "sub-1");

    private static SubscriptionDto trial() {
        return new SubscriptionDto(SubscriptionDto.State.TRIAL, true, Instant.parse("2026-11-10T12:00:00Z"), false, 30,
                null, null, List.of(new SubscriptionDto.FeatureUse(PaidFeature.NARRATIVE, 3, 60)));
    }

    @Test
    void signedOutIsA401() throws Exception {
        given(pilots.current(any())).willReturn(Optional.empty());
        mockMvc.perform(get("/api/subscription")).andExpect(status().isUnauthorized());
    }

    @Test
    void thePilotsSubscriptionWithTheMonthsUses() throws Exception {
        given(pilots.current(any())).willReturn(Optional.of(PILOT));
        given(subscriptions.status(any())).willReturn(trial());
        mockMvc.perform(get("/api/subscription").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("TRIAL"))
                .andExpect(jsonPath("$.entitled").value(true))
                .andExpect(jsonPath("$.uses[0].feature").value("NARRATIVE"))
                .andExpect(jsonPath("$.uses[0].used").value(3));
    }

    @Test
    void theFreeMonthStartsOnceAndIsA409After() throws Exception {
        given(pilots.current(any())).willReturn(Optional.of(PILOT));
        given(subscriptions.startTrial(any())).willReturn(trial()).willThrow(new SubscriptionService.TrialUsedException());
        mockMvc.perform(post("/api/subscription/trial").with(oidcLogin()).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.until").value("2026-11-10T12:00:00Z"));
        mockMvc.perform(post("/api/subscription/trial").with(oidcLogin()).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("Your free month has already been used."));
    }

    @Test
    void a_deployment_that_sells_none_says_nothing_of_one() throws Exception {
        given(subscriptions.sold()).willReturn(false);
        mockMvc.perform(get("/api/subscription").with(oidcLogin())).andExpect(status().isNotFound());
        mockMvc.perform(post("/api/subscription/trial").with(oidcLogin()).with(csrf())).andExpect(status().isNotFound());
    }
}
