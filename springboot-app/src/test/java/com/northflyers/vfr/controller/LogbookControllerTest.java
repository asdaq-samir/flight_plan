package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.CurrencyDto;
import com.northflyers.vfr.service.CurrencyService;
import com.northflyers.vfr.service.LogbookService;
import com.northflyers.vfr.service.PilotService;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The logbook's HTTP contract: 401 signed out, a bad entry 400, a good
 *  one 200, someone else's entry 404, and the currency as computed. */
@WebMvcTest(LogbookController.class)
@Import(com.northflyers.vfr.security.SecurityConfig.class)
class LogbookControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private LogbookService logbook;

    @MockitoBean
    private CurrencyService currency;

    @MockitoBean
    private PilotService pilotService;

    private static final Pilot PILOT = new Pilot("pilot@example.com", "A. Pilot", "sub-1");

    private static final String ENTRY = """
            {"flownOn": "2026-09-20", "aircraft": "N12345", "aircraftType": "C172", "route": "C81 KDLH",
             "totalHours": 3.4, "nightHours": 0, "crossCountryHours": 3.4, "dayLandings": 1, "nightLandings": 0}
            """;

    @Test
    void list_returns401_whenSignedOut() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.empty());
        mockMvc.perform(get("/api/logbook")).andExpect(status().isUnauthorized());
    }

    @Test
    void add_returns200_withTheEntry() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        given(logbook.add(any(), any())).willReturn(new LogbookEntry(PILOT)
                .set(LocalDate.of(2026, 9, 20), "N12345", "C172", "C81 KDLH", 3.4, 0, 3.4, 1, 0, null));

        mockMvc.perform(post("/api/logbook").with(oidcLogin()).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(ENTRY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.route").value("C81 KDLH"))
                .andExpect(jsonPath("$.flownOn").value("2026-09-20"));
    }

    @Test
    void add_returns400_forNegativeHoursOrNoDate() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        mockMvc.perform(post("/api/logbook").with(oidcLogin()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(ENTRY.replace("\"totalHours\": 3.4", "\"totalHours\": -1")))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/logbook").with(oidcLogin()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(ENTRY.replace("\"flownOn\": \"2026-09-20\",", "")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void update_and_delete_return404_forAnEntryThatIsNotThisPilots() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        given(logbook.update(any(), anyLong(), any())).willReturn(Optional.empty());
        given(logbook.delete(any(), eq(7L))).willReturn(false);

        mockMvc.perform(put("/api/logbook/7").with(oidcLogin()).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(ENTRY))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/logbook/7").with(oidcLogin()).with(csrf())).andExpect(status().isNotFound());
    }

    @Test
    void currency_returns200_asComputed() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        given(logbook.list(any())).willReturn(List.of());
        given(currency.currency(any(), any(), any())).willReturn(new CurrencyDto(
                LocalDate.of(2026, 12, 19), null, LocalDate.of(2025, 6, 14), LocalDate.of(2027, 6, 30), null, 4.0, 0, 3.4, 9, 4));

        mockMvc.perform(get("/api/logbook/currency").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dayPassengersUntil").value("2026-12-19"))
                .andExpect(jsonPath("$.flightReviewUntil").value("2027-06-30"));
    }
}
