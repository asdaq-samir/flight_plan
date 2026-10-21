package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.AccountService;
import com.northflyers.vfr.service.PilotService;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The pilot's own contact for a flight plan's item 19 C/ (AIM Appendix
 *  4): 401 signed out, a number or a home base the form cannot take 400,
 *  and the pilot back with their name, number and home base. */
@WebMvcTest(PilotController.class)
@Import(com.northflyers.vfr.security.SecurityConfig.class)
class PilotControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PilotService pilotService;

    @MockitoBean
    private AccountService accountService;

    private static Pilot pilot() {
        Pilot pilot = new Pilot("pilot@example.com", "A. Pilot", "sub-1");
        pilot.setFullName("Avery B. Pilot");
        return pilot;
    }

    @Test
    void me_saysTheirNameNumberAndHomeBase() throws Exception {
        Pilot pilot = pilot();
        pilot.setContact("608-555-0100", "KMSN");
        given(pilotService.current(any())).willReturn(Optional.of(pilot));

        mockMvc.perform(get("/api/me").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fullName").value("Avery B. Pilot"))
                .andExpect(jsonPath("$.phone").value("608-555-0100"))
                .andExpect(jsonPath("$.homeBase").value("KMSN"));
    }

    @Test
    void contact_returns401_whenSignedOut() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.empty());

        mockMvc.perform(put("/api/me/contact").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"608-555-0100\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void contact_isSavedAndTheirsComesBack() throws Exception {
        Pilot pilot = pilot();
        given(pilotService.current(any())).willReturn(Optional.of(pilot));
        Pilot saved = pilot();
        saved.setContact("+1 (608) 555-0100", "C81");
        given(pilotService.setContact(eq(pilot), eq("+1 (608) 555-0100"), eq("c81"))).willReturn(saved);

        mockMvc.perform(put("/api/me/contact").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"+1 (608) 555-0100\",\"homeBase\":\"c81\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phone").value("+1 (608) 555-0100"))
                .andExpect(jsonPath("$.homeBase").value("C81"));
    }

    /** Blank is none: a pilot takes either out by clearing it. */
    @Test
    void contact_takesBlankAsNone() throws Exception {
        Pilot pilot = pilot();
        given(pilotService.current(any())).willReturn(Optional.of(pilot));
        given(pilotService.setContact(eq(pilot), eq(""), eq(""))).willReturn(pilot);

        mockMvc.perform(put("/api/me/contact").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"\",\"homeBase\":\"\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void contact_returns400_forANumberOrAHomeBaseTheFormCannotTake() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(pilot()));
        String[][] cases = {
            {"{\"phone\":\"call me\"}", "phone"},
            {"{\"phone\":\"" + "1".repeat(25) + "\"}", "phone"},
            {"{\"homeBase\":\"K\"}", "homeBase"},
            {"{\"homeBase\":\"KMSN-1\"}", "homeBase"},
            {"{\"homeBase\":\"" + "K".repeat(12) + "\"}", "homeBase"},
        };
        for (String[] c : cases) {
            mockMvc.perform(put("/api/me/contact").with(oidcLogin()).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(c[0]))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.details[0]").value(org.hamcrest.Matchers.startsWith(c[1] + ":")));
        }
        verify(pilotService, never()).setContact(any(), any(), any());
    }
}
