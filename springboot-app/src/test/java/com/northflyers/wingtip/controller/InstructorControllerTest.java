package com.northflyers.wingtip.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.wingtip.domain.Pilot;
import com.northflyers.wingtip.service.InstructorService;
import com.northflyers.wingtip.service.LessonService;
import com.northflyers.wingtip.service.LogbookService;
import com.northflyers.wingtip.service.PilotService;
import com.northflyers.wingtip.service.TrainingService;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The instructor's HTTP contract: 401 signed out, a student not theirs
 *  404 and nothing signed or set, a certificate or a lesson not shaped
 *  like one 400, and a refusal answered with its own status and words. */
@WebMvcTest(InstructorController.class)
@Import(com.northflyers.wingtip.security.SecurityConfig.class)
class InstructorControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private InstructorService instructors;

    @MockitoBean
    private LessonService lessons;

    @MockitoBean
    private TrainingService training;

    @MockitoBean
    private LogbookService logbook;

    @MockitoBean
    private PilotService pilotService;

    private static final Pilot CFI = new Pilot("cfi@example.com", "J. J. Jones", "sub-2");
    private static final Pilot STUDENT = new Pilot("student@example.com", "A. Student", "sub-1");

    private static final String SIGN = "{\"code\": \"solo-first\", \"fields\": {\"mm\": \"Cessna 172\"},"
            + " \"text\": \"I certify ...\", \"signedOn\": \"2026-10-13\"}";

    @Test
    void get_returns401_whenSignedOut() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.empty());
        mockMvc.perform(get("/api/instructor").with(oidcLogin())).andExpect(status().isUnauthorized());
    }

    @Test
    void aStudentNotTheirsIs404_andNothingIsSigned() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(CFI));
        given(instructors.student(CFI, 7L)).willReturn(Optional.empty());
        mockMvc.perform(get("/api/instructor/students/7/training").with(oidcLogin())).andExpect(status().isNotFound());
        mockMvc.perform(post("/api/instructor/students/7/endorsements").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(SIGN))
                .andExpect(status().isNotFound());
        verify(instructors, never()).sign(any(), any(), any(), any());
    }

    @Test
    void aRefusalIsAnsweredWithItsOwnStatusAndWords() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(CFI));
        given(instructors.student(CFI, 8L)).willReturn(Optional.of(STUDENT));
        given(instructors.sign(eq(CFI), eq(STUDENT), any(), any()))
                .willThrow(new InstructorService.Refused(HttpStatus.CONFLICT, "The words have changed since you read them."));
        mockMvc.perform(post("/api/instructor/students/8/endorsements").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(SIGN))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("The words have changed since you read them."));
    }

    @Test
    void aCertificateNotShapedLikeOneIs400() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(CFI));
        mockMvc.perform(put("/api/instructor").with(oidcLogin()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fullName\": \"J. J. Jones\", \"certificate\": \"98 76\", \"until\": \"2027-12-31\","
                                + " \"untilKind\": \"RE\"}"))
                .andExpect(status().isBadRequest());
        verify(instructors, never()).setInstructor(any(), any());
    }

    private static final String LESSON = "{\"airportIdent\": \"KDLH\", \"procedureId\": \"I09\", \"procedureName\": \"ILS RWY 09\","
            + " \"cycle\": \"261029\", \"fixNotes\": {\"PYKLA\": \"Power to 1,800 rpm, gear down\"}, \"dueOn\": \"2026-11-08\"}";

    @Test
    void aLessonForAStudentNotTheirsIs404_andNothingIsSet() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(CFI));
        given(instructors.student(CFI, 7L)).willReturn(Optional.empty());
        mockMvc.perform(post("/api/instructor/students/7/lessons").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(LESSON))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/instructor/students/7/lessons/3").with(oidcLogin()).with(csrf()))
                .andExpect(status().isNotFound());
        verify(lessons, never()).assign(any(), any(), any(), any());
        verify(lessons, never()).remove(any(), any(), any());
    }

    @Test
    void aLessonIsSetForTheirStudent_andOneNotShapedLikeOneIs400() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(CFI));
        given(instructors.student(CFI, 8L)).willReturn(Optional.of(STUDENT));
        given(training.trainingFor(eq(CFI), eq(STUDENT), any(), any())).willReturn(new com.northflyers.wingtip.dto.TrainingDto(
                java.util.List.of(), java.util.List.of(), java.util.List.of(), java.util.List.of(), java.util.List.of(), null,
                java.util.List.of(), java.util.List.of(), java.util.List.of()));
        mockMvc.perform(post("/api/instructor/students/8/lessons").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(LESSON))
                .andExpect(status().isOk());
        verify(lessons).assign(eq(CFI), eq(STUDENT), any(), any());
        // A fix's identifier with a space in it, and an airport's of seven letters.
        mockMvc.perform(post("/api/instructor/students/8/lessons").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(LESSON.replace("PYKLA", "PY KLA")))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/instructor/students/8/lessons").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(LESSON.replace("KDLH", "KDLHXYZ")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aTrackNotPutToThemIs404() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(CFI));
        given(lessons.reviewedTrack(CFI, 8L, 99L)).willReturn(Optional.empty());
        mockMvc.perform(get("/api/instructor/students/8/flights/99/track").with(oidcLogin())).andExpect(status().isNotFound());
    }
}
