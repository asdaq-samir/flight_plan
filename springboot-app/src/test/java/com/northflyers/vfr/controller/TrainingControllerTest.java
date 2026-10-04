package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.EndorsementDto;
import com.northflyers.vfr.dto.ExperienceItemDto;
import com.northflyers.vfr.dto.TrainingDto;
import com.northflyers.vfr.service.LogbookService;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.TrainingService;
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

/** The training record's HTTP contract: 401 signed out, the record as
 *  reckoned, a code not an ACS code 400, an endorsement set and taken out. */
@WebMvcTest(TrainingController.class)
@Import(com.northflyers.vfr.security.SecurityConfig.class)
class TrainingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TrainingService training;

    @MockitoBean
    private LogbookService logbook;

    @MockitoBean
    private PilotService pilotService;

    private static final Pilot PILOT = new Pilot("student@example.com", "A. Student", "sub-1");

    private static final TrainingDto RECORD = new TrainingDto(
            List.of(new ExperienceItemDto("total", "61.109(a)", "Flight time", 12.5, 40, "h", false)),
            List.of("PA.I.E.K1"),
            List.of(new EndorsementDto("pre-solo-knowledge", LocalDate.of(2026, 9, 1))));

    @Test
    void get_returns401_whenSignedOut() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.empty());
        mockMvc.perform(get("/api/training").with(oidcLogin())).andExpect(status().isUnauthorized());
    }

    @Test
    void get_returnsTheRecord() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        given(training.training(eq(PILOT), any(), any())).willReturn(RECORD);
        mockMvc.perform(get("/api/training").with(oidcLogin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.experience[0].rule").value("61.109(a)"))
                .andExpect(jsonPath("$.knowledgeTestCodes[0]").value("PA.I.E.K1"))
                .andExpect(jsonPath("$.endorsements[0].code").value("pre-solo-knowledge"));
    }

    @Test
    void knowledgeTest_refusesACodeThatIsNotAnAcsCode() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        mockMvc.perform(put("/api/training/knowledge-test").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"codes\": [\"PA.I.E.K1\", \"not a code\"]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void knowledgeTest_keepsTheCodes() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        given(training.setKnowledgeTestCodes(eq(PILOT), any())).willReturn(PILOT);
        given(training.training(eq(PILOT), any(), any())).willReturn(RECORD);
        mockMvc.perform(put("/api/training/knowledge-test").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"codes\": [\"PA.I.E.K1\", \"IR.III.B.K2\"]}"))
                .andExpect(status().isOk());
        verify(training).setKnowledgeTestCodes(PILOT, List.of("PA.I.E.K1", "IR.III.B.K2"));
    }

    @Test
    void endorse_setsTheDay_andWithdrawAnUnknownOneIs404() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        given(training.training(eq(PILOT), any(), any())).willReturn(RECORD);
        mockMvc.perform(put("/api/training/endorsements/solo-xc-training").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"endorsedOn\": \"2026-10-01\"}"))
                .andExpect(status().isOk());
        verify(training).endorse(PILOT, "solo-xc-training", LocalDate.of(2026, 10, 1));
        given(training.withdraw(PILOT, "nope")).willReturn(false);
        mockMvc.perform(delete("/api/training/endorsements/nope").with(oidcLogin()).with(csrf()))
                .andExpect(status().isNotFound());
    }

    @Test
    void endorse_refusesACodeOfItsOwnShape() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(PILOT));
        mockMvc.perform(put("/api/training/endorsements/NOT_OURS").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"endorsedOn\": \"2026-10-01\"}"))
                .andExpect(status().isBadRequest());
    }
}
