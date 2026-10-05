package com.northflyers.vfr.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.controller.SignInCapabilitiesController;
import com.northflyers.vfr.service.PilotService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The phone's stack: its public address https on the LAN, where the
 * same host's plain port also answers. The http page could not sign in
 * once the browser held the https port's Secure cookies, so that host
 * over http goes to https; every other host stays where it was.
 */
@WebMvcTest(SignInCapabilitiesController.class)
@Import(SecurityConfig.class)
@TestPropertySource(properties = "app.public-base-url=https://10.0.0.218:8443")
class HttpsRedirectTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    @Test
    void thePublicHostOverHttpGoesToHttps() throws Exception {
        mockMvc.perform(get("http://10.0.0.218:8080/api/auth/capabilities"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("https://10.0.0.218:8443/api/auth/capabilities"));
    }

    @Test
    void otherHostsAndHttpsAreLeftAlone() throws Exception {
        mockMvc.perform(get("http://localhost:8080/api/auth/capabilities")).andExpect(status().isOk());
        mockMvc.perform(get("http://host.docker.internal:8080/api/auth/capabilities")).andExpect(status().isOk());
        mockMvc.perform(get("https://10.0.0.218:8443/api/auth/capabilities")).andExpect(status().isOk());
    }
}
