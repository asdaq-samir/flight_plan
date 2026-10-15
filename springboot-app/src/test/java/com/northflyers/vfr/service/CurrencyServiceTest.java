package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.CurrencyDto;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 14 CFR 61.57 and 61.56, from a logbook; 61.57(c)'s instrument
 *  currency by its own words, the month of the flight not counted. */
class CurrencyServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 11);
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

        CurrencyDto c = currency.currency(log, null, null, null, TODAY);

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

        CurrencyDto c = currency.currency(log, null, null, null, TODAY);

        assertThat(c.nightPassengersUntil()).isEqualTo(LocalDate.of(2026, 11, 30));
        assertThat(c.dayPassengersUntil()).isEqualTo(LocalDate.of(2026, 12, 19));
    }

    @Test
    void fewerThanThreeLandingsIsNoCurrency() {
        assertThat(currency.currency(List.of(entry(LocalDate.of(2026, 9, 20), 1.0, 2, 0)), null, null, null, TODAY).dayPassengersUntil()).isNull();
    }

    @Test
    void aFlightReviewIsGoodToTheEndOfThe24thCalendarMonth() {
        CurrencyDto c = currency.currency(List.of(), LocalDate.of(2025, 6, 14), LocalDate.of(2027, 6, 30), null, TODAY);

        assertThat(c.flightReviewUntil()).isEqualTo(LocalDate.of(2027, 6, 30));
        assertThat(c.medicalExpiresOn()).isEqualTo(LocalDate.of(2027, 6, 30));
    }

    private LogbookEntry ifr(LocalDate on, int approaches, boolean holding, boolean tracking) {
        return entry(on, 1.0, 1, 0).instrument(approaches, holding, tracking);
    }

    @Test
    void sixApproachesHoldingAndTrackingInJanuaryAreCurrentThroughJuly() {
        // 61.57(c)(1): a flight in July looks back over January to June; one
        // in August over February to July.
        List<LogbookEntry> log = List.of(ifr(LocalDate.of(2026, 1, 10), 4, true, false), ifr(LocalDate.of(2026, 1, 25), 2, false, true));
        CurrencyDto c = currency.currency(log, null, null, null, LocalDate.of(2026, 7, 15));
        assertThat(c.instrumentCurrentUntil()).isEqualTo(LocalDate.of(2026, 7, 31));
        // 61.57(d): six calendar months more, then only a check.
        assertThat(c.ipcNeededAfter()).isEqualTo(LocalDate.of(2027, 1, 31));
        // July's lookback, January to June.
        assertThat(c.approachesInWindow()).isEqualTo(6);
        assertThat(c.holdingInWindow()).isTrue();
        assertThat(c.trackingInWindow()).isTrue();
    }

    @Test
    void approachesSpreadOverMonthsAreCurrentWhileAllSixAreInTheWindow() {
        // Three in January, three in March: current for flights in April to
        // July, whose six preceding months hold all six; not in August,
        // whose window (February to July) has three.
        List<LogbookEntry> log = List.of(ifr(LocalDate.of(2026, 1, 10), 3, true, true), ifr(LocalDate.of(2026, 3, 5), 3, false, false));
        assertThat(currency.currency(log, null, null, null, TODAY).instrumentCurrentUntil()).isEqualTo(LocalDate.of(2026, 7, 31));
    }

    @Test
    void approachesFlownThisMonthCountFromNextMonth() {
        List<LogbookEntry> log = List.of(ifr(LocalDate.of(2026, 10, 2), 6, true, true));
        CurrencyDto c = currency.currency(log, null, null, null, TODAY);
        // October's own approaches are not in October's window...
        assertThat(c.approachesInWindow()).isZero();
        // ...and are current for November to April.
        assertThat(c.instrumentCurrentUntil()).isEqualTo(LocalDate.of(2027, 4, 30));
    }

    @Test
    void fiveApproachesOrNoHoldingIsNoCurrency() {
        assertThat(currency.currency(List.of(ifr(LocalDate.of(2026, 9, 1), 5, true, true)), null, null, null, TODAY)
                .instrumentCurrentUntil()).isNull();
        assertThat(currency.currency(List.of(ifr(LocalDate.of(2026, 9, 1), 6, false, true)), null, null, null, TODAY)
                .instrumentCurrentUntil()).isNull();
    }

    @Test
    void anInstrumentProficiencyCheckIsCurrentToTheEndOfTheSixthMonthAfter() {
        CurrencyDto c = currency.currency(List.of(), null, null, LocalDate.of(2026, 9, 18), TODAY);
        assertThat(c.instrumentCurrentUntil()).isEqualTo(LocalDate.of(2027, 3, 31));
        assertThat(c.ipcOn()).isEqualTo(LocalDate.of(2026, 9, 18));
    }
}
