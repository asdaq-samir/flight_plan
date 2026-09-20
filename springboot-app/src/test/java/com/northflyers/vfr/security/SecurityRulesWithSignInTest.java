package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.controller.PilotController;
import com.northflyers.vfr.service.PilotService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The same rules as {@link SecurityRulesTest}, in a deployment where a
 * session can actually be obtained: a mail host is configured, so the
 * magic link sends. Reading from the planner stays public; writing
 * through it now needs the session.
 */
@WebMvcTest(PilotController.class)
@Import(SecurityConfig.class)
@TestPropertySource(properties = "spring.mail.host=smtp.example.com")
class SecurityRulesWithSignInTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    @Test
    void readingFromThePlannerStaysPublic() throws Exception {
        mockMvc.perform(get("/api/planner/course"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotEqualTo(401));
    }

    @Test
    void writingThroughThePlannerNeedsASession() throws Exception {
        mockMvc.perform(post("/api/planner/picks").with(csrf()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aSignedInPilotMayWriteThroughThePlanner() throws Exception {
        mockMvc.perform(post("/api/planner/picks").with(oidcLogin()).with(csrf()))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotIn(401, 403));
    }
}
