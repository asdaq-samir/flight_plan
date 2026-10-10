package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.controller.PilotController;
import com.northflyers.vfr.controller.SignInCapabilitiesController;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.PilotRole;
import com.northflyers.vfr.service.AccountService;
import com.northflyers.vfr.service.PilotService;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;

/**
 * The same rules as {@link SecurityRulesTest}, in a deployment where a
 * session can actually be obtained: a mail host is configured, so the
 * magic link sends. Reading from the planner stays public; writing
 * through it now needs the session, and the developer's work needs the
 * developer role on top of it.
 *
 * <p>The planner proxy is not in this slice, so a request security lets
 * through ends in a 404 here. What each case checks is only whether
 * security refused it, and with which status.
 */
@WebMvcTest({PilotController.class, SignInCapabilitiesController.class})
@Import(SecurityConfig.class)
@TestPropertySource(properties = "spring.mail.host=smtp.example.com")
class SecurityRulesWithSignInTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    @MockitoBean
    private AccountService accountService;

    /** A 204, not the default redirect to /login?logout: this app has no
     *  such page, and the page's fetch read its 401 as the logout failing. */
    @Test
    void loggingOutAnswersNoContent() throws Exception {
        signedInAs(PilotRole.PILOT);
        mockMvc.perform(post("/logout").with(oidcLogin()).with(csrf()))
                .andExpect(status().isNoContent());
    }

    @Test
    void readingFromThePlannerStaysPublic() throws Exception {
        mockMvc.perform(get("/api/planner/course"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotEqualTo(401));
    }

    /** ForeFlight's download manager asks for the pack's size first, with
     *  no session; the rest of the planner takes no HEAD. */
    @Test
    void theForeFlightPackAnswersAHeadToo() throws Exception {
        mockMvc.perform(head("/api/planner/foreflight-pack/C81-KDLH/C81-KDLH-checkpoints.zip"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotEqualTo(401));
        mockMvc.perform(head("/api/planner/course")).andExpect(status().isUnauthorized());
    }

    @Test
    void writingThroughThePlannerNeedsASession() throws Exception {
        mockMvc.perform(post("/api/planner/picks").with(csrf()))
                .andExpect(status().isUnauthorized());
    }

    /** A refused request is not saved for a redirect back after sign-in,
     *  which this app never makes (sign-in lands by SignInLanding). Saving
     *  it is what made a session for every signed-out visit, and with
     *  sessions kept in Postgres for 30 days, a row there for each. */
    @Test
    void aRefusedRequestIsNotSavedForLater() throws Exception {
        mockMvc.perform(get("/api/flights"))
                .andExpect(status().isUnauthorized())
                .andExpect(result -> {
                    var session = result.getRequest().getSession(false);
                    assertThat(session == null ? null : session.getAttribute("SPRING_SECURITY_SAVED_REQUEST")).isNull();
                });
    }

    @Test
    void aSignedInPilotMayWriteThroughThePlanner() throws Exception {
        signedInAs(PilotRole.PILOT);
        mockMvc.perform(post("/api/planner/checkpoint-notes").with(oidcLogin()).with(csrf()))
                .andExpect(notRefused());
        mockMvc.perform(post("/api/planner/build").with(oidcLogin()).with(csrf()))
                .andExpect(notRefused());
    }

    @Test
    void aPlainPilotMayNotDoTheDevelopersWork() throws Exception {
        signedInAs(PilotRole.PILOT);
        mockMvc.perform(post("/api/planner/retrain").with(oidcLogin()).with(csrf())).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/planner/charts/refresh").with(oidcLogin()).with(csrf())).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/planner/picks").with(oidcLogin()).with(csrf())).andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/planner/picks").with(oidcLogin()).with(csrf())).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/planner/oral/question").with(oidcLogin()).with(csrf())).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/planner/dev/services/airflow/start").with(oidcLogin()).with(csrf()))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/planner/status").with(oidcLogin())).andExpect(status().isForbidden());
        mockMvc.perform(get("/api/planner/dev/services").with(oidcLogin())).andExpect(status().isForbidden());
    }

    @Test
    void aDeveloperMayDoTheDevelopersWork() throws Exception {
        signedInAs(PilotRole.DEVELOPER);
        mockMvc.perform(post("/api/planner/retrain").with(oidcLogin()).with(csrf())).andExpect(notRefused());
        mockMvc.perform(post("/api/planner/picks").with(oidcLogin()).with(csrf())).andExpect(notRefused());
        mockMvc.perform(post("/api/planner/oral/grade").with(oidcLogin()).with(csrf())).andExpect(notRefused());
        mockMvc.perform(get("/api/planner/status").with(oidcLogin())).andExpect(notRefused());
        mockMvc.perform(get("/api/planner/dev/services").with(oidcLogin())).andExpect(notRefused());
    }

    /** No session at all is a 401, the answer that tells the page to
     *  offer sign-in, rather than the 403 a plain pilot gets. */
    @Test
    void theStacksStatusIsNotReadWithoutASession() throws Exception {
        mockMvc.perform(get("/api/planner/status")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/planner/dev/services")).andExpect(status().isUnauthorized());
    }

    /** Every narrative is a real, billed Claude call. */
    @Test
    void aNarrativeNeedsASession() throws Exception {
        mockMvc.perform(post("/api/comparison").with(csrf())).andExpect(status().isUnauthorized());
        signedInAs(PilotRole.PILOT);
        mockMvc.perform(post("/api/comparison").with(oidcLogin()).with(csrf())).andExpect(notRefused());
    }

    private void signedInAs(PilotRole role) {
        Pilot pilot = new Pilot("pilot@example.com", "A. Pilot", "sub-1");
        ReflectionTestUtils.setField(pilot, "role", role);
        given(pilotService.current(any())).willReturn(Optional.of(pilot));
    }

    private static ResultMatcher notRefused() {
        return result -> assertThat(result.getResponse().getStatus()).isNotIn(401, 403);
    }

    @Test
    void theCapabilitiesSayHowThisDeploymentIsReached() throws Exception {
        mockMvc.perform(get("/api/auth/capabilities"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access").value("SIGN_IN"))
                // Signed in by the emailed link alone: no Google or Apple
                // button, which would open a blank 401.
                .andExpect(jsonPath("$.providers").isEmpty());
    }
}
