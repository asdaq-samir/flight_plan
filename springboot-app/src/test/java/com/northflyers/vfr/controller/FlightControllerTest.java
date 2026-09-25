package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.FlightService;
import com.northflyers.vfr.service.PilotService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import com.northflyers.vfr.controller.FlightApiMapperImpl;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Same shape as {@link AircraftControllerTest} -- see there for why
 *  {@link FlightService}/{@link PilotService} are mocked rather than a
 *  real pilot-scoping check. */
@org.springframework.context.annotation.Import(FlightApiMapperImpl.class)
@WebMvcTest(FlightController.class)
@Import(com.northflyers.vfr.security.SecurityConfig.class)
class FlightControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FlightService flightService;

    @MockitoBean
    private PilotService pilotService;

    private static Pilot samplePilot() {
        return new Pilot("pilot@example.com", "A. Pilot", "sub-1");
    }

    private static Flight sampleFlight() {
        Flight flight = new Flight(samplePilot(), null, "C81", "KDLH");
        FlightCheckpoint checkpoint = new FlightCheckpoint(0, "C81", "departure", 42.0, -88.0, 0.0);
        flight.fileNavLog(List.of(checkpoint), 2500, 323.4, 205.0, 29.0);
        return flight;
    }

    @Test
    void list_returns401_whenSignedOut() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.empty());

        mockMvc.perform(get("/api/flights")).andExpect(status().isUnauthorized());
    }

    @Test
    void list_returns200_withThisPilotsFlights() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(flightService.list(any())).willReturn(List.of(sampleFlight()));

        mockMvc.perform(get("/api/flights").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].departureIdent").value("C81"));
    }

    @Test
    void get_returns404_whenTheFlightIsNotThisPilots() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(flightService.get(any(), anyLong())).willReturn(Optional.empty());

        mockMvc.perform(get("/api/flights/999").with(oidcLogin())).andExpect(status().isNotFound());
    }

    @Test
    void get_returns200_withTheFiledNavLog() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(flightService.get(any(), anyLong())).willReturn(Optional.of(sampleFlight()));

        mockMvc.perform(get("/api/flights/1").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkpoints[0].name").value("C81"))
                .andExpect(jsonPath("$.totalFuelGal").value(29.0));
    }

    @Test
    void save_returns400_whenDepartureIdentIsTheWrongShape() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/flights").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"toolongident\",\"destinationIdent\":\"KDLH\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void save_returns200_forAValidRequest() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(flightService.save(any(), any())).willReturn(sampleFlight());

        mockMvc.perform(post("/api/flights").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"C81\",\"destinationIdent\":\"KDLH\",\"checkpoints\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.destinationIdent").value("KDLH"));
    }
}
