package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.dto.CurrencyDto;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.List;
import java.util.function.ToIntFunction;
import org.springframework.stereotype.Service;

/**
 * A pilot's currency, reckoned from their logbook and the two dates they
 * give, by the rules a VFR private pilot lives by:
 *
 * <ul>
 * <li>Passengers by day, 14 CFR 61.57(a): three takeoffs and landings in
 *     the preceding 90 days -- current until 90 days after the third most
 *     recent landing.</li>
 * <li>Passengers at night, 61.57(b): three of them to a full stop at
 *     night in the preceding 90 days, counted from the night landings
 *     alone.</li>
 * <li>The flight review, 61.56: within the preceding 24 calendar months,
 *     so good to the end of the 24th month after the one it was passed
 *     in.</li>
 * <li>The medical: the day it expires, as the pilot gives it (when that
 *     falls depends on its class and the pilot's age).</li>
 * </ul>
 *
 * <p>A logbook is only as good as what is in it: none of this is
 * anyone's sign-off, and the page says so.
 */
@Service
public class CurrencyService {

    /** 61.57's window, in days. */
    static final int PASSENGER_DAYS = 90;
    /** 61.56's, in calendar months. */
    static final int FLIGHT_REVIEW_MONTHS = 24;

    public CurrencyDto currency(List<LogbookEntry> entries, LocalDate flightReviewOn, LocalDate medicalExpiresOn) {
        return new CurrencyDto(
                passengersUntil(entries, e -> e.getDayLandings() + e.getNightLandings()),
                passengersUntil(entries, LogbookEntry::getNightLandings),
                flightReviewOn,
                flightReviewOn == null ? null : YearMonth.from(flightReviewOn).plusMonths(FLIGHT_REVIEW_MONTHS).atEndOfMonth(),
                medicalExpiresOn,
                round(entries.stream().mapToDouble(LogbookEntry::getTotalHours).sum()),
                round(entries.stream().mapToDouble(LogbookEntry::getNightHours).sum()),
                round(entries.stream().mapToDouble(LogbookEntry::getCrossCountryHours).sum()),
                entries.stream().mapToInt(e -> e.getDayLandings() + e.getNightLandings()).sum(),
                entries.size());
    }

    /** 90 days after the day the third most recent landing was made on;
     *  null with fewer than three logged. */
    static LocalDate passengersUntil(List<LogbookEntry> entries, ToIntFunction<LogbookEntry> landings) {
        int counted = 0;
        for (LogbookEntry entry : entries.stream().sorted(Comparator.comparing(LogbookEntry::getFlownOn).reversed()).toList()) {
            counted += landings.applyAsInt(entry);
            if (counted >= 3) {
                return entry.getFlownOn().plusDays(PASSENGER_DAYS);
            }
        }
        return null;
    }

    private static double round(double hours) {
        return Math.round(hours * 10) / 10.0;
    }
}
