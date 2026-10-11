package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.flightservice.NotConnectedFlightService;
import com.northflyers.vfr.service.PilotService;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** With no Flight Service provider -- the app's own, until the owner's
 *  agreement -- the status says so, a good flight plan is a 503 that says
 *  where to file it, and a badly written one a 400 first. */
@WebMvcTest(FlightServiceController.class)
@Import({com.northflyers.vfr.security.SecurityConfig.class, NotConnectedFlightService.class})
class FlightServiceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    private static final String PLAN = """
            {"rules": "IFR", "aircraftId": "N12345", "aircraftType": "C172/L", "departure": "C81",
             "departureTime": "2026-10-12T15:05:00Z", "cruisingSpeed": "N0110", "cruisingLevel": "A060",
             "route": "BAE V191 OSH", "destination": "KATW", "eetMinutes": 65, "alternate": "KMSN",
             "enduranceMinutes": 268, "personsOnBoard": 2}
            """;

    @Test
    void withNoProviderTheStatusSaysSoAndAFilingIsA503SayingWhereToFile() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(new Pilot("pilot@example.com", "A. Pilot", "sub-1")));
        mockMvc.perform(get("/api/flight-service").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(false))
                .andExpect(jsonPath("$.provider").value("none"));
        mockMvc.perform(post("/api/flight-service/flight-plans").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(PLAN))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("1800wxbrief.com")));
        mockMvc.perform(post("/api/flight-service/briefings").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(PLAN))
                .andExpect(status().isServiceUnavailable());
        // A speed not written as item 15 has it is refused before anything.
        mockMvc.perform(post("/api/flight-service/flight-plans").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(PLAN.replace("N0110", "110")))
                .andExpect(status().isBadRequest());
    }
}
