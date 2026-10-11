package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.dto.CurrencyDto;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** What is coming up on a day: within 30 days, each by the nearer of its
 *  two reminders -- 30 days before, then 7 -- in the rule's words; nothing
 *  past or further off. */
class ReminderDueTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 11);

    private static CurrencyDto currency(LocalDate review, LocalDate medical, LocalDate day, LocalDate night, LocalDate instrument) {
        return new CurrencyDto(day, night, null, review, medical, 100, 5, 20, 50, 30, instrument, null, null, 0, false, false);
    }

    @Test
    void eachWithinThirtyDaysByTheNearerOfItsTwoReminders() {
        List<ReminderService.Reminder> due = ReminderService.due(currency(
                LocalDate.of(2026, 11, 8),     // 28 days: the 30-day one
                LocalDate.of(2026, 10, 18),    // 7 days: the 7-day one
                LocalDate.of(2026, 11, 20),    // 40 days: none yet
                LocalDate.of(2026, 10, 10),    // yesterday: run out, none
                TODAY), TODAY);                 // today: the 7-day one
        assertThat(due).extracting(ReminderService.Reminder::what).containsExactly("flight-review", "medical", "instrument");
        assertThat(due).extracting(ReminderService.Reminder::daysBefore).containsExactly(30, 7, 7);
        assertThat(due.get(0).words()).isEqualTo("Your flight review runs out 8 November 2026, in 28 days (14 CFR 61.56(c)).");
        assertThat(due.get(2).words()).isEqualTo("Your instrument currency runs out 11 October 2026, today (14 CFR 61.57(c)).");
    }

    @Test
    void oneReminderIsItsOwnSubjectAndSeveralAreCounted() {
        var pilot = new com.northflyers.vfr.domain.Pilot("pilot@example.com", "A. Pilot", "sub-1");
        List<ReminderService.Reminder> due = ReminderService.due(currency(null, LocalDate.of(2026, 10, 12), null, null, null), TODAY);
        assertThat(ReminderService.message(pilot, due).getSubject()).isEqualTo("Wingtip Maps: Your medical certificate runs out 12 October 2026");
        assertThat(ReminderService.message(pilot, due).getText()).contains("- Your medical certificate runs out 12 October 2026, tomorrow (14 CFR 61.23).");
        List<ReminderService.Reminder> two = ReminderService.due(currency(LocalDate.of(2026, 10, 20), LocalDate.of(2026, 10, 12), null, null, null), TODAY);
        assertThat(ReminderService.message(pilot, two).getSubject()).isEqualTo("Wingtip Maps: 2 dates coming up");
    }
}
