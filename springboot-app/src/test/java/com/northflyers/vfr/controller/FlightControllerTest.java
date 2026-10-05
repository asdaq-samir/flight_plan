package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.TrackDto;
import com.northflyers.vfr.dto.TrackPointDto;
import com.northflyers.vfr.service.FlightService;
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

/** Same shape as {@link AircraftControllerTest} -- see there for why
 *  {@link FlightService}/{@link PilotService} are mocked rather than a
 *  real pilot-scoping check. */
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
                .andExpect(jsonPath("$[0].departureIdent").value("C81"))
                .andExpect(jsonPath("$[0].stops").isEmpty());
    }

    @Test
    void list_carriesTheStopsAFlightLandsAt() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(flightService.list(any())).willReturn(List.of(sampleFlight().withStops(List.of("KMSN", "KEAU"))));

        mockMvc.perform(get("/api/flights").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].stops[0]").value("KMSN"))
                .andExpect(jsonPath("$[0].stops[1]").value("KEAU"));
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
    void save_returns400_whenAStopIsTheWrongShape() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/flights").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"C81\",\"destinationIdent\":\"KDLH\",\"stops\":[\"not an ident\"]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void save_returns400_whenTheRiskLevelIsNotOneOfTheThree() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/flights").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"C81\",\"destinationIdent\":\"KDLH\","
                                + "\"risk\":{\"score\":4,\"level\":\"fine\",\"factors\":[]}}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void theRiskAssessmentIsSavedWithTheFlightAndListedWithIt() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        Flight assessed = sampleFlight().assessed(9, "caution", List.of("Night", "Somewhere to be by a time"));
        given(flightService.save(any(), any())).willReturn(assessed);
        given(flightService.list(any())).willReturn(List.of(assessed));

        mockMvc.perform(post("/api/flights").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"departureIdent\":\"C81\",\"destinationIdent\":\"KDLH\",\"checkpoints\":[],"
                                + "\"risk\":{\"score\":9,\"level\":\"caution\",\"factors\":[\"Night\",\"Somewhere to be by a time\"]}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.risk.level").value("caution"));
        mockMvc.perform(get("/api/flights").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].risk.score").value(9))
                .andExpect(jsonPath("$[0].risk.factors[1]").value("Somewhere to be by a time"));
    }

    @Test
    void oneFlightComesWithItsNavLog_andAnotherPilotsIsNotFound() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(flightService.get(any(), org.mockito.ArgumentMatchers.eq(7L))).willReturn(Optional.of(sampleFlight()));
        given(flightService.get(any(), org.mockito.ArgumentMatchers.eq(8L))).willReturn(Optional.empty());

        mockMvc.perform(get("/api/flights/7").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkpoints[0].name").value("C81"));
        mockMvc.perform(get("/api/flights/8").with(oidcLogin())).andExpect(status().isNotFound());
    }

    @Test
    void aTrackIsSavedRead_andOneWithAPointOffTheEarthRefused() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(flightService.saveTrack(any(), any(), any())).willReturn(true);
        given(flightService.track(any(), any())).willReturn(Optional.of(new TrackDto("flight.gpx", List.of(
                new TrackPointDto(1L, 42.0, -88.0, 900.0), new TrackPointDto(2L, 42.1, -88.0, null)))));
        String body = "{\"source\":\"flight.gpx\",\"points\":[{\"t\":1,\"lat\":42,\"lon\":-88,\"altFt\":900},"
                + "{\"t\":2,\"lat\":%s,\"lon\":-88,\"altFt\":null}]}";

        mockMvc.perform(put("/api/flights/7/track").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body.formatted("42.1")))
                .andExpect(status().isNoContent());
        mockMvc.perform(put("/api/flights/7/track").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body.formatted("95")))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/flights/7/track").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.points[1].altFt").isEmpty());
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
