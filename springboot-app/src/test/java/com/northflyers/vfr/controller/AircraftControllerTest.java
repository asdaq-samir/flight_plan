package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.AircraftService;
import com.northflyers.vfr.service.PilotService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The HTTP contract: signed out is 401 (not a redirect a fetch() would
 *  silently follow), a bad body is 400, a good one is 200. {@link AircraftService}
 *  and {@link PilotService} are both mocked -- pilot-scoping itself lives
 *  in {@code AircraftRepository#findByIdAndPilotId} and is exercised by
 *  actually running the app, not re-proven with a mock here. */
@WebMvcTest(AircraftController.class)
@Import(com.northflyers.vfr.security.SecurityConfig.class)
class AircraftControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AircraftService aircraftService;

    @MockitoBean
    private PilotService pilotService;

    private static Pilot samplePilot() {
        return new Pilot("pilot@example.com", "A. Pilot", "sub-1");
    }

    private static Aircraft sampleAircraft() {
        return new Aircraft(samplePilot(), "N12345", "C172", 110, 8.5, 40.0);
    }

    /** A method the path doesn't map is a 405, not the catch-all 500 --
     *  see {@code GlobalExceptionHandler}. */
    @Test
    void put_returns405_becauseTheCollectionOnlyListsAndCreates() throws Exception {
        mockMvc.perform(put("/api/aircraft").with(oidcLogin()).with(csrf()))
                .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void list_returns401_whenSignedOut() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.empty());

        mockMvc.perform(get("/api/aircraft")).andExpect(status().isUnauthorized());
    }

    @Test
    void list_returns200_withThisPilotsAircraft() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(aircraftService.list(any())).willReturn(List.of(sampleAircraft()));

        mockMvc.perform(get("/api/aircraft").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].tailNumber").value("N12345"));
    }

    @Test
    void add_returns400_whenTailNumberIsBlank() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tailNumber\":\"\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":110,\"fuelBurnGph\":8.5}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Invalid request"));
    }

    @Test
    void add_returns400_whenCruiseTasIsNotPositive() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tailNumber\":\"N1\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":0,\"fuelBurnGph\":8.5}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void add_returns200_forAValidRequest() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(aircraftService.add(any(), anyString(), anyString(), anyDouble(), anyDouble(), any()))
                .willReturn(sampleAircraft());

        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tailNumber\":\"N12345\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":110,\"fuelBurnGph\":8.5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tailNumber").value("N12345"));
    }

    @Test
    void delete_returns404_whenTheAircraftIsNotThisPilots() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(aircraftService.delete(any(), anyLong())).willReturn(false);

        mockMvc.perform(delete("/api/aircraft/999").with(oidcLogin()).with(csrf()))
                .andExpect(status().isNotFound());
    }
}
