package com.northflyers.vfr.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
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

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.AircraftDto;
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
        return new Aircraft(samplePilot(), "N12345", "C172", 110, 8.5, null, null, null, 40.0);
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

    /** Longer than the column was a database error, reported as a
     *  tail number already on file. */
    @Test
    void add_returns400_namingTheField_whenTheTailNumberIsLongerThanItsColumn() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tailNumber\":\"N12345678901234567\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":110,\"fuelBurnGph\":8.5}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details[0]").value("tailNumber: tailNumber must be at most 16 characters"));
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
        given(aircraftService.add(any(), anyString(), anyString(), anyDouble(), anyDouble(), any(), any(), any(), any()))
                .willReturn(sampleAircraft());

        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tailNumber\":\"N12345\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":110,\"fuelBurnGph\":8.5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tailNumber").value("N12345"));
    }

    /** The cruise's power and the climb's own speed and burn go through
     *  to the aeroplane and back: the nav log flies every leg and every
     *  climb on them. */
    @Test
    void add_passesTheCruisePowerAndTheClimbsOwnSpeedAndBurnThrough() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(aircraftService.add(any(), eq("N12345"), eq("C172"), eq(110.0), eq(8.5), eq(65.0), eq(74.0), eq(11.0),
                eq(40.0)))
                .willReturn(new Aircraft(samplePilot(), "N12345", "C172", 110, 8.5, 65.0, 74.0, 11.0, 40.0));

        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tailNumber\":\"N12345\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":110,"
                                + "\"fuelBurnGph\":8.5,\"cruisePowerPct\":65,\"climbTasKt\":74,\"climbFuelBurnGph\":11,"
                                + "\"usableFuelGal\":40}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cruisePowerPct").value(65.0))
                .andExpect(jsonPath("$.climbTasKt").value(74.0))
                .andExpect(jsonPath("$.climbFuelBurnGph").value(11.0));
    }

    /** A power no cruise table has is refused, as the planner refuses it. */
    @Test
    void add_returns400_whenTheCruisePowerIsOutsideACruiseTable() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        for (int power : new int[] {30, 101}) {
            mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"tailNumber\":\"N1\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":110,"
                                    + "\"fuelBurnGph\":8.5,\"cruisePowerPct\":" + power + "}"))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    void add_returns400_whenTheClimbSpeedIsNotPositive() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));

        mockMvc.perform(post("/api/aircraft").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tailNumber\":\"N1\",\"typeDesignator\":\"C172\",\"cruiseTasKt\":110,"
                                + "\"fuelBurnGph\":8.5,\"climbTasKt\":0}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void delete_returns404_whenTheAircraftIsNotThisPilots() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(aircraftService.delete(any(), anyLong())).willReturn(false);

        mockMvc.perform(delete("/api/aircraft/999").with(oidcLogin()).with(csrf()))
                .andExpect(status().isNotFound());
    }

    /** 14 CFR 91.171: a VOR check recorded with its date, kind, place and
     *  error; good for 30 days, and within 4 degrees at a VOT. */
    @Test
    void aVorCheckIsRecordedAndSaysHowLongItIsGoodFor() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(aircraftService.recordVorCheck(any(), eq(7L), any(), any(), any(), anyDouble())).willReturn(Optional.of(
                sampleAircraft().recordVorCheck(java.time.LocalDate.of(2026, 10, 1), com.northflyers.vfr.domain.VorCheck.VOT,
                        "KDLH VOT", -5.0)));

        mockMvc.perform(put("/api/aircraft/7/vor-check").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"checkedOn\":\"2026-10-01\",\"kind\":\"VOT\",\"place\":\"KDLH VOT\",\"errorDeg\":-5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.vorCheck.goodThrough").value("2026-10-31"))
                .andExpect(jsonPath("$.vorCheck.limitDeg").value(4.0))
                // 5 degrees off at a VOT is over its 4.
                .andExpect(jsonPath("$.vorCheck.withinLimit").value(false));

        mockMvc.perform(put("/api/aircraft/7/vor-check").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"checkedOn\":\"2999-01-01\",\"kind\":\"VOT\",\"errorDeg\":1}"))
                .andExpect(status().isBadRequest());
    }

    /** 14 CFR 91.409(a), 91.411(a), 91.413(a), 91.207(d): each good to the
     *  end of its calendar month 12 or 24 months on -- an annual on
     *  5 October 2025 to 31 October 2026, an annual on 31 January 2026 to
     *  31 January 2027 -- and the 100-hour due 100 hours of time in service
     *  after the last (91.409(b)). */
    @Test
    void theInspectionsAreRecordedEachWithTheLastDayItIsGoodFor() throws Exception {
        given(pilotService.current(any())).willReturn(Optional.of(samplePilot()));
        given(aircraftService.recordInspections(any(), eq(7L), any())).willReturn(Optional.of(
                sampleAircraft().recordInspections(java.time.LocalDate.of(2025, 10, 5), 1200.5, 1290.0,
                        java.time.LocalDate.of(2024, 11, 30), java.time.LocalDate.of(2025, 2, 1),
                        java.time.LocalDate.of(2026, 1, 31), java.time.LocalDate.of(2028, 6, 1))));

        mockMvc.perform(put("/api/aircraft/7/inspections").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"annualOn\":\"2025-10-05\",\"hundredHourAtHours\":1200.5,\"hoursNow\":1290,"
                                + "\"staticCheckOn\":\"2024-11-30\",\"transponderCheckOn\":\"2025-02-01\","
                                + "\"eltInspectedOn\":\"2026-01-31\",\"eltBatteryDueOn\":\"2028-06-01\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inspections.annualGoodThrough").value("2026-10-31"))
                .andExpect(jsonPath("$.inspections.hundredHourDueAtHours").value(1300.5))
                .andExpect(jsonPath("$.inspections.staticCheckGoodThrough").value("2026-11-30"))
                .andExpect(jsonPath("$.inspections.transponderCheckGoodThrough").value("2027-02-28"))
                .andExpect(jsonPath("$.inspections.eltInspectionGoodThrough").value("2027-01-31"))
                .andExpect(jsonPath("$.inspections.eltBatteryDueOn").value("2028-06-01"));

        // An inspection to come is not one done; negative hours are no hours.
        mockMvc.perform(put("/api/aircraft/7/inspections").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"annualOn\":\"2999-01-01\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(put("/api/aircraft/7/inspections").with(oidcLogin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"hoursNow\":-1}"))
                .andExpect(status().isBadRequest());
    }

    /** An airplane whose owner has said nothing is neither current nor overdue. */
    @Test
    void noInspectionsRecordedIsNoDates() {
        AircraftDto.InspectionsDto none = AircraftController.inspectionsOf(sampleAircraft());
        org.assertj.core.api.Assertions.assertThat(none.annualGoodThrough()).isNull();
        org.assertj.core.api.Assertions.assertThat(none.hundredHourDueAtHours()).isNull();
        org.assertj.core.api.Assertions.assertThat(none.eltBatteryDueOn()).isNull();
    }
}
