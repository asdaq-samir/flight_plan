package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.controller.PilotController;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.PilotService;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The access rules, tested as rules.
 *
 * <p>Worth its own test because "which endpoints need a session" is a
 * decision that is easy to state and easy to get silently wrong -- a
 * matcher in the wrong order, or a path added later that falls through to
 * {@code permitAll}. Each case here fails loudly if the split between
 * shared and pilot-scoped data moves.
 */
@WebMvcTest(PilotController.class)
@Import(SecurityConfig.class)
class SecurityRulesTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    @Test
    void anAnonymousCallerIsRefusedWith401RatherThanRedirected() throws Exception {
        // A redirect here is the trap: fetch() follows it and reports a
        // 200 carrying a login page.
        mockMvc.perform(get("/api/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aSignedInPilotSeesThemselves() throws Exception {
        given(pilotService.current(any()))
                .willReturn(Optional.of(new Pilot("pilot@example.com", "A. Pilot", "sub-1")));

        mockMvc.perform(get("/api/me").with(oidcLogin()
                        .idToken(token -> token.claim("sub", "sub-1").claim("email", "pilot@example.com"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("pilot@example.com"));
    }

    /** The Google subject is an authentication detail and must not be
     *  serialised out, which is why the endpoint returns a DTO. */
    @Test
    void theResponseDoesNotLeakTheGoogleSubject() throws Exception {
        given(pilotService.current(any()))
                .willReturn(Optional.of(new Pilot("pilot@example.com", "A. Pilot", "sub-secret")));

        mockMvc.perform(get("/api/me").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.googleSubject").doesNotExist());
    }

    /** Aircraft and flights are private to whoever owns them, so a
     *  caller with no session is refused before AircraftController --
     *  not in this slice -- ever runs. */
    @Test
    void aircraftAndFlightsRequireASession() throws Exception {
        mockMvc.perform(get("/api/aircraft")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/flights")).andExpect(status().isUnauthorized());
    }

    @Test
    void healthAndDocsStayReachableWithoutASession() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotEqualTo(401));
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotEqualTo(401));
    }

    /** Session cookies are attached by the browser automatically, which is
     *  the condition CSRF exploits, so a state-changing call without a
     *  token is refused even when the caller is signed in. */
    @Test
    void aStateChangingCallWithoutACsrfTokenIsRefused() throws Exception {
        mockMvc.perform(post("/api/aircraft").with(oidcLogin()))
                .andExpect(status().isForbidden());
    }

    @Test
    void theSameCallWithACsrfTokenIsNotRefusedByCsrf() throws Exception {
        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf()))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotEqualTo(403));
    }
}
