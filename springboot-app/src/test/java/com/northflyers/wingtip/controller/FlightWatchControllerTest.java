package com.northflyers.wingtip.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.wingtip.domain.Pilot;
import com.northflyers.wingtip.dto.BriefingChangeDto;
import com.northflyers.wingtip.dto.BriefingSourceDto;
import com.northflyers.wingtip.dto.FlightWatchDto;
import com.northflyers.wingtip.service.FlightWatchService;
import com.northflyers.wingtip.service.PilotService;
import com.northflyers.wingtip.service.PlannerClient;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Same shape as {@link FlightControllerTest}: the service and the pilot
 *  are mocked, and what is checked is the answers' statuses and JSON. */
@WebMvcTest(FlightWatchController.class)
@Import(com.northflyers.wingtip.security.SecurityConfig.class)
class FlightWatchControllerTest {

    private static final Instant DEPART = Instant.parse("2026-11-04T14:00:00Z");
    private static final Instant CHECKED = Instant.parse("2026-11-03T20:00:00Z");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FlightWatchService watches;

    @MockitoBean
    private PilotService pilotService;

    private static Pilot samplePilot() {
        return new Pilot("pilot@example.com", "A. Pilot", "sub-1");
    }

    private static FlightWatchDto sampleWatch() {
        return new FlightWatchDto(7L, DEPART, CHECKED, CHECKED,
                List.of(new BriefingChangeDto("KDLH's ceiling is forecast 1,500 ft, down from 4,000.", List.of("taf:KDLH"))),
                List.of(new BriefingSourceDto("taf:KDLH", "TAF KDLH 031720Z", "KDLH 031720Z 0318/0418 ...")));
    }

    @Test
    void watch_returns401_whenSignedOut() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.empty());

        mockMvc.perform(post("/api/flights/7/watch").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departAt\":\"2026-11-04T14:00:00Z\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void watch_returns200_withTheWatchAndItsChanges() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(watches.watch(any(), eq(7L), eq(DEPART))).willReturn(Optional.of(sampleWatch()));

        mockMvc.perform(post("/api/flights/7/watch").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departAt\":\"2026-11-04T14:00:00Z\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flightId").value(7))
                .andExpect(jsonPath("$.departAt").value("2026-11-04T14:00:00Z"))
                .andExpect(jsonPath("$.changes[0].text").value("KDLH's ceiling is forecast 1,500 ft, down from 4,000."))
                .andExpect(jsonPath("$.changes[0].sources[0]").value("taf:KDLH"))
                .andExpect(jsonPath("$.sources[0].label").value("TAF KDLH 031720Z"));
    }

    @Test
    void watch_returns400_withoutADepartureTime() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/flights/7/watch").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void watch_returns404_forAnotherPilotsFlight() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(watches.watch(any(), eq(8L), any())).willReturn(Optional.empty());

        mockMvc.perform(post("/api/flights/8/watch").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departAt\":\"2026-11-04T14:00:00Z\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void watch_returns502_whenThePlannerCannotBriefIt() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(watches.watch(any(), eq(7L), any()))
                .willThrow(new PlannerClient.Unavailable("the planner could not be reached for the briefing"));

        mockMvc.perform(post("/api/flights/7/watch").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departAt\":\"2026-11-04T14:00:00Z\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("the planner could not be reached for the briefing"));
    }

    @Test
    void watch_isRefusedWithoutTheCsrfToken() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/flights/7/watch").with(oidcLogin())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departAt\":\"2026-11-04T14:00:00Z\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void get_returnsTheWatch_andNoneIs404() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(watches.watchOf(any(), eq(7L))).willReturn(Optional.of(sampleWatch()));
        given(watches.watchOf(any(), eq(8L))).willReturn(Optional.empty());

        mockMvc.perform(get("/api/flights/7/watch").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.changedAt").value("2026-11-03T20:00:00Z"))
                .andExpect(jsonPath("$.changes[0].text").value("KDLH's ceiling is forecast 1,500 ft, down from 4,000."));
        mockMvc.perform(get("/api/flights/8/watch").with(oidcLogin())).andExpect(status().isNotFound());
    }

    @Test
    void unwatch_returns204_andNoneIs404() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(watches.unwatch(any(), eq(7L))).willReturn(true);
        given(watches.unwatch(any(), eq(8L))).willReturn(false);

        mockMvc.perform(delete("/api/flights/7/watch").with(oidcLogin()).with(csrf())).andExpect(status().isNoContent());
        mockMvc.perform(delete("/api/flights/8/watch").with(oidcLogin()).with(csrf())).andExpect(status().isNotFound());
    }
}
