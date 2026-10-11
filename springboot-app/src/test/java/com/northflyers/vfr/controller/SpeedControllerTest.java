package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.PilotRole;
import com.northflyers.vfr.repository.SpeedSampleRepository;
import com.northflyers.vfr.security.SecurityConfig;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.SpeedService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The speed trend's three doors, through the deployed security rules: a
 * pilot's browser reports with no session and no CSRF token, as
 * sendBeacon sends it, within its hour's allowance; the lab run only
 * with the deployment's token; and only the developer reads the trend.
 */
@WebMvcTest(SpeedController.class)
@Import(SecurityConfig.class)
@TestPropertySource(properties = {"spring.mail.host=smtp.example.com", "app.speed.lab-token=lab-secret"})
class SpeedControllerTest {

    private static final String FIELD = """
            {"page": "plan", "device": "phone", "version": "4855639",
             "metrics": {"LCP": 1840.5, "INP": 96, "CLS": 0.02}}""";

    private static final String LAB = """
            {"page": "plan", "device": "phone", "commit": "2cafd50",
             "metrics": {"open_app": 1060, "lighthouse_performance": 92}}""";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private SpeedService speed;

    @MockitoBean
    private PilotService pilotService;

    @Test
    void aBrowsersReportIsKeptWithNoSessionOrToken() throws Exception {
        mockMvc.perform(post("/api/speed/field").header("X-Forwarded-For", "203.0.113.10")
                        .contentType(MediaType.APPLICATION_JSON).content(FIELD))
                .andExpect(status().isNoContent());

        verify(speed).record("field", "plan", "phone", "4855639", Map.of("LCP", 1840.5, "INP", 96.0, "CLS", 0.02));
    }

    @Test
    void aMetricThatIsNotAWebVitalIsRefused() throws Exception {
        mockMvc.perform(post("/api/speed/field").header("X-Forwarded-For", "203.0.113.11")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(FIELD.replace("\"CLS\"", "\"position\"")))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/speed/field").header("X-Forwarded-For", "203.0.113.11")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(FIELD.replace("1840.5", "-1")))
                .andExpect(status().isBadRequest());

        verify(speed, never()).record(anyString(), anyString(), anyString(), anyString(), anyMap());
    }

    @Test
    void pastTheHoursAllowanceReportsAreDroppedQuietly() throws Exception {
        for (int i = 0; i < SpeedController.PER_HOUR + 5; i++) {
            mockMvc.perform(post("/api/speed/field").header("X-Forwarded-For", "203.0.113.12")
                            .contentType(MediaType.APPLICATION_JSON).content(FIELD))
                    .andExpect(status().isNoContent());
        }

        verify(speed, times(SpeedController.PER_HOUR)).record(eq("field"), anyString(), anyString(), anyString(), anyMap());
    }

    @Test
    void theLabRunNeedsTheDeploymentsToken() throws Exception {
        mockMvc.perform(post("/api/speed/lab").contentType(MediaType.APPLICATION_JSON).content(LAB))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/speed/lab").header("X-Speed-Token", "guess")
                        .contentType(MediaType.APPLICATION_JSON).content(LAB))
                .andExpect(status().isForbidden());
        verify(speed, never()).record(anyString(), anyString(), anyString(), anyString(), anyMap());

        mockMvc.perform(post("/api/speed/lab").header("X-Speed-Token", "lab-secret")
                        .contentType(MediaType.APPLICATION_JSON).content(LAB))
                .andExpect(status().isNoContent());
        verify(speed).record("lab", "plan", "phone", "2cafd50", Map.of("open_app", 1060.0, "lighthouse_performance", 92.0));
    }

    @Test
    void onlyTheDeveloperReadsTheTrend() throws Exception {
        mockMvc.perform(get("/api/speed")).andExpect(status().isUnauthorized());

        signedInAs(PilotRole.PILOT);
        mockMvc.perform(get("/api/speed").with(oidcLogin())).andExpect(status().isForbidden());

        signedInAs(PilotRole.DEVELOPER);
        given(speed.trend(anyInt())).willReturn(List.of(day()));
        mockMvc.perform(get("/api/speed").param("days", "9000").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].metric").value("LCP"))
                .andExpect(jsonPath("$[0].p75").value(2100.0));
        // As far back as a sample is kept, however far is asked.
        verify(speed).trend(SpeedController.MOST_DAYS);
    }

    private void signedInAs(PilotRole role) {
        Pilot pilot = new Pilot("pilot@example.com", "A. Pilot", "sub-1");
        ReflectionTestUtils.setField(pilot, "role", role);
        given(pilotService.current(any())).willReturn(Optional.of(pilot));
    }

    private static SpeedSampleRepository.Day day() {
        return new SpeedSampleRepository.Day() {
            public String getDay() { return "2026-10-11"; }
            public String getSource() { return "field"; }
            public String getMetric() { return "LCP"; }
            public String getDevice() { return "phone"; }
            public double getP50() { return 1700; }
            public double getP75() { return 2100; }
            public long getCount() { return 12; }
            public String getVersion() { return "4855639"; }
        };
    }
}
