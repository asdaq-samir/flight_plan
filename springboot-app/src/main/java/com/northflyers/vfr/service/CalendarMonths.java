package com.northflyers.vfr.service;

import java.time.LocalDate;
import java.time.YearMonth;

/**
 * The FAA's "calendar months", which every dated rule here counts in: the
 * flight review (14 CFR 61.56(c), 24), the annual and the ELT (91.409(a),
 * 91.207(d), 12), the static system and transponder checks (91.411(a),
 * 91.413(a), 24). Something done "within the preceding N calendar months"
 * is good to the last day of the Nth month after the one it was done in,
 * whatever day of that month it was -- an annual on 5 October 2025 is good
 * through 31 October 2026.
 */
public final class CalendarMonths {

    private CalendarMonths() {
    }

    /** The last day of the calendar month `months` after the one `on` is
     *  in; null without a date. */
    public static LocalDate endOfMonthAfter(LocalDate on, int months) {
        return on == null ? null : YearMonth.from(on).plusMonths(months).atEndOfMonth();
    }
}
