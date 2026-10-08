package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.security.SecurityConfig;
import com.northflyers.vfr.service.PilotService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * An error on a pilot's phone reaches the log -- through the deployed
 * security rules, with no session and no CSRF token, as sendBeacon sends
 * it -- without the page's query, on one line, and no more than the
 * hour's allowance per caller.
 */
@WebMvcTest(ClientErrorController.class)
@Import(SecurityConfig.class)
@ExtendWith(OutputCaptureExtension.class)
class ClientErrorControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    private static String report(String message, String page) {
        return """
                {"message": "%s", "stack": "TypeError: x is undefined\\n    at plan.js:1:2", "page": "%s",
                 "userAgent": "iPhone", "kind": "error"}""".formatted(message, page);
    }

    @Test
    void aReportIsLoggedWithoutTheQueryWithNoSessionOrToken(CapturedOutput output) throws Exception {
        mockMvc.perform(post("/api/client-errors").header("X-Forwarded-For", "203.0.113.1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(report("x is undefined", "/app/plan?token=secret-magic-link#map")))
                .andExpect(status().isNoContent());

        assertThat(output.getOut()).contains("client error [error] x is undefined at /app/plan (iPhone)")
                .doesNotContain("secret-magic-link");
    }

    @Test
    void aMessageCannotForgeASecondLine(CapturedOutput output) throws Exception {
        mockMvc.perform(post("/api/client-errors").header("X-Forwarded-For", "203.0.113.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(report("first\\nclient error [error] forged", "/app/plan")))
                .andExpect(status().isNoContent());

        assertThat(output.getOut()).contains("client error [error] first client error [error] forged at /app/plan");
    }

    @Test
    void aStackCannotForgeALineNorCarryAQuery(CapturedOutput output) throws Exception {
        mockMvc.perform(post("/api/client-errors").header("X-Forwarded-For", "203.0.113.4")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"message": "GET /api/airports/nearest?lat=41.2&lon=-87.9 failed",
                                 "stack": "boom\\nclient error [error] forged\\n    at x?lat=41.2:1:2",
                                 "page": "/app/plan", "userAgent": "iPhone", "kind": "error"}"""))
                .andExpect(status().isNoContent());

        assertThat(output.getOut()).contains("GET /api/airports/nearest failed")
                .contains("\n    client error [error] forged")
                .doesNotContain("\nclient error [error] forged")
                .doesNotContain("lat=41.2");
    }

    @Test
    void notAReportIsRefused() throws Exception {
        mockMvc.perform(post("/api/client-errors").contentType(MediaType.APPLICATION_JSON).content("{\"message\": \"\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void pastTheHoursAllowanceReportsAreDroppedQuietly(CapturedOutput output) throws Exception {
        for (int i = 0; i < ClientErrorController.PER_HOUR + 5; i++) {
            mockMvc.perform(post("/api/client-errors").header("X-Forwarded-For", "203.0.113.3")
                            .contentType(MediaType.APPLICATION_JSON).content(report("loop " + i, "/app/plan")))
                    .andExpect(status().isNoContent());
        }
        assertThat(output.getOut()).contains("loop " + (ClientErrorController.PER_HOUR - 1))
                .doesNotContain("loop " + ClientErrorController.PER_HOUR + " ");
    }
}
