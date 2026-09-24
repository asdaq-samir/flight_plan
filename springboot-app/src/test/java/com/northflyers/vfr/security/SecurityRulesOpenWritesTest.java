package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
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
 * The local stack's rules: nobody can sign in, and the deployment has
 * said so out loud (app.open-writes, docker-compose.yml), so the
 * training workspace and the narrative work signed out. May 404 here --
 * the proxies are not in this slice -- what matters is that security did
 * not refuse them.
 */
@WebMvcTest(PilotController.class)
@Import(SecurityConfig.class)
@TestPropertySource(properties = "app.open-writes=true")
class SecurityRulesOpenWritesTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    @Test
    void plannerWritesAndTheNarrativeAreOpen() throws Exception {
        mockMvc.perform(post("/api/planner/picks").with(csrf()))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotIn(401, 403));
        mockMvc.perform(post("/api/planner/retrain").with(csrf()))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotIn(401, 403));
        mockMvc.perform(get("/api/planner/status"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotIn(401, 403));
        mockMvc.perform(post("/api/comparison").with(csrf()))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotIn(401, 403));
    }

    /** Opening planner writes does not open anyone's aircraft or flights. */
    @Test
    void pilotScopedDataStillNeedsASession() throws Exception {
        mockMvc.perform(get("/api/aircraft")).andExpect(status().isUnauthorized());
    }
}
