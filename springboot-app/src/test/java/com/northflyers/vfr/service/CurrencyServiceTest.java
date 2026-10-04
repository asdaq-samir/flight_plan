package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.CurrencyDto;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 14 CFR 61.57 and 61.56, from a logbook. */
class CurrencyServiceTest {

    private final CurrencyService currency = new CurrencyService();
    private final Pilot pilot = new Pilot("pilot@example.com", "A. Pilot", "sub-1");

    private LogbookEntry entry(LocalDate on, double hours, int day, int night) {
        return new LogbookEntry(pilot).set(on, "N12345", "C172", null, hours, night > 0 ? 1.0 : 0, 0, day, night, null);
    }

    @Test
    void passengersByDayAre90DaysFromTheThirdMostRecentLanding() {
        List<LogbookEntry> log = List.of(
                entry(LocalDate.of(2026, 9, 20), 1.0, 1, 0),
                entry(LocalDate.of(2026, 9, 1), 1.0, 1, 0),
                entry(LocalDate.of(2026, 8, 10), 1.0, 2, 0),
                entry(LocalDate.of(2026, 6, 1), 1.0, 5, 0));

        CurrencyDto c = currency.currency(log, null, null);

        assertThat(c.dayPassengersUntil()).isEqualTo(LocalDate.of(2026, 8, 10).plusDays(90));
        assertThat(c.landings()).isEqualTo(9);
        assertThat(c.totalHours()).isEqualTo(4.0);
        assertThat(c.flights()).isEqualTo(4);
    }

    @Test
    void atNightOnlyTheNightLandingsCount() {
        List<LogbookEntry> log = List.of(
                entry(LocalDate.of(2026, 9, 20), 1.0, 5, 2),
                entry(LocalDate.of(2026, 9, 1), 1.0, 0, 1));

        CurrencyDto c = currency.currency(log, null, null);

        assertThat(c.nightPassengersUntil()).isEqualTo(LocalDate.of(2026, 11, 30));
        assertThat(c.dayPassengersUntil()).isEqualTo(LocalDate.of(2026, 12, 19));
    }

    @Test
    void fewerThanThreeLandingsIsNoCurrency() {
        assertThat(currency.currency(List.of(entry(LocalDate.of(2026, 9, 20), 1.0, 2, 0)), null, null).dayPassengersUntil()).isNull();
    }

    @Test
    void aFlightReviewIsGoodToTheEndOfThe24thCalendarMonth() {
        CurrencyDto c = currency.currency(List.of(), LocalDate.of(2025, 6, 14), LocalDate.of(2027, 6, 30));

        assertThat(c.flightReviewUntil()).isEqualTo(LocalDate.of(2027, 6, 30));
        assertThat(c.medicalExpiresOn()).isEqualTo(LocalDate.of(2027, 6, 30));
    }
}
