package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.ExperienceItemDto;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** 14 CFR 61.109(a), from a logbook. */
class TrainingServiceTest {

    private final Pilot pilot = new Pilot("student@example.com", "A. Student", "sub-1");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 15);

    private LogbookEntry entry(LocalDate on, double total, double night, double xc, int day, int nightLandings,
                               double dual, double solo, double instrument, int towered, double distance, double longest) {
        return new LogbookEntry(pilot).set(on, "N12345", "C172", null, total, night, xc, day, nightLandings, null)
                .training(dual, solo, instrument, towered, distance, longest);
    }

    private Map<String, ExperienceItemDto> experience(List<LogbookEntry> log) {
        return TrainingService.experience(log, TODAY).stream().collect(Collectors.toMap(ExperienceItemDto::key, i -> i));
    }

    @Test
    void dualCrossCountryAndNightAreTheSmallerOfTheTwoColumnsOnEachEntry() {
        Map<String, ExperienceItemDto> x = experience(List.of(
                // Two hours of dual, one of it cross-country, at night: one of each.
                entry(LocalDate.of(2026, 9, 1), 2.0, 1.5, 1.0, 0, 4, 2.0, 0, 0, 0, 0, 0),
                // Solo cross-country isn't dual cross-country.
                entry(LocalDate.of(2026, 9, 5), 2.5, 0, 2.5, 2, 0, 0, 2.5, 0, 0, 0, 0)));
        assertThat(x.get("dualCrossCountry").have()).isEqualTo(1.0);
        assertThat(x.get("dualNight").have()).isEqualTo(1.5);
        assertThat(x.get("nightLandings").have()).isEqualTo(4);
        assertThat(x.get("soloCrossCountry").have()).isEqualTo(2.5);
        assertThat(x.get("total").have()).isEqualTo(4.5);
        assertThat(x.get("total").met()).isFalse();
    }

    @Test
    void theLongSoloCrossCountryNeeds150NmThreeFullStopsAndALegOver50() {
        LogbookEntry shortOne = entry(LocalDate.of(2026, 9, 10), 3.0, 0, 3.0, 3, 0, 0, 3.0, 0, 1, 140, 60);
        LogbookEntry twoStops = entry(LocalDate.of(2026, 9, 11), 3.5, 0, 3.5, 2, 0, 0, 3.5, 0, 1, 160, 60);
        LogbookEntry theOne = entry(LocalDate.of(2026, 9, 12), 3.6, 0, 3.6, 3, 0, 0, 3.6, 0, 2, 158, 62);
        assertThat(experience(List.of(shortOne, twoStops)).get("longSoloCrossCountry").met()).isFalse();
        Map<String, ExperienceItemDto> x = experience(List.of(shortOne, twoStops, theOne));
        assertThat(x.get("longSoloCrossCountry").met()).isTrue();
        assertThat(x.get("toweredLandings").have()).isEqualTo(4);
        assertThat(x.get("toweredLandings").met()).isTrue();
    }

    @Test
    void checkrideTrainingCountsFromTheFirstOfTheMonthTwoMonthsBack() {
        Map<String, ExperienceItemDto> x = experience(List.of(
                entry(LocalDate.of(2026, 7, 31), 2.0, 0, 0, 1, 0, 2.0, 0, 0, 0, 0, 0),
                entry(LocalDate.of(2026, 8, 1), 1.5, 0, 0, 1, 0, 1.5, 0, 0, 0, 0, 0),
                entry(LocalDate.of(2026, 10, 2), 1.5, 0, 0, 1, 0, 1.5, 0, 0, 0, 0, 0)));
        assertThat(x.get("checkridePrep").have()).isEqualTo(3.0);
        assertThat(x.get("checkridePrep").met()).isTrue();
        assertThat(x.get("dual").have()).isEqualTo(5.0);
    }

    @Test
    void theNightCrossCountryIsDualAtNightOverAHundredMiles() {
        LogbookEntry night = entry(LocalDate.of(2026, 9, 20), 2.2, 2.2, 2.2, 0, 3, 2.2, 0, 0, 0, 104, 52);
        assertThat(experience(List.of(night)).get("nightCrossCountry").met()).isTrue();
        LogbookEntry byDay = entry(LocalDate.of(2026, 9, 21), 2.2, 0, 2.2, 3, 0, 2.2, 0, 0, 0, 104, 52);
        assertThat(experience(List.of(byDay)).get("nightCrossCountry").met()).isFalse();
    }

    @Test
    void theKnowledgeTestCodesComeBackAsGiven() {
        pilot.setKnowledgeTestCodes("PA.I.E.K1 PA.I.D.K2");
        assertThat(TrainingService.codesOf(pilot)).containsExactly("PA.I.E.K1", "PA.I.D.K2");
        pilot.setKnowledgeTestCodes(null);
        assertThat(TrainingService.codesOf(pilot)).isEmpty();
    }
}
