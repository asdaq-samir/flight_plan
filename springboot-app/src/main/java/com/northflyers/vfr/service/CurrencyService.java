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
 * <li>Instrument currency, 61.57(c)(1): within the 6 calendar months
 *     preceding the month of the flight, six instrument approaches,
 *     holding procedures and tasks, and intercepting and tracking courses.
 *     Read as the rule is written, the month of the flight itself not
 *     counted -- an approach flown this month counts from next month on,
 *     the stricter reading, as the FAA has not said otherwise -- so it
 *     runs to the end of the last month whose six preceding months hold
 *     all three; or, after an instrument proficiency check (61.57(d)), to
 *     the end of the sixth month after the check's. More than six
 *     calendar months past that, only a check restores it (61.57(d)).</li>
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
    /** 61.57(c)(1)'s lookback, and 61.57(d)'s grace after it, in calendar months. */
    static final int INSTRUMENT_MONTHS = 6;
    /** 61.57(c)(1)(i). */
    static final int APPROACHES = 6;

    public CurrencyDto currency(List<LogbookEntry> entries, LocalDate flightReviewOn, LocalDate medicalExpiresOn,
                                LocalDate ipcOn, LocalDate today) {
        LocalDate instrumentUntil = instrumentUntil(entries, ipcOn);
        YearMonth month = YearMonth.from(today);
        List<LogbookEntry> window = inWindow(entries, month);
        return new CurrencyDto(
                passengersUntil(entries, e -> e.getDayLandings() + e.getNightLandings()),
                passengersUntil(entries, LogbookEntry::getNightLandings),
                flightReviewOn,
                CalendarMonths.endOfMonthAfter(flightReviewOn, FLIGHT_REVIEW_MONTHS),
                medicalExpiresOn,
                round(entries.stream().mapToDouble(LogbookEntry::getTotalHours).sum()),
                round(entries.stream().mapToDouble(LogbookEntry::getNightHours).sum()),
                round(entries.stream().mapToDouble(LogbookEntry::getCrossCountryHours).sum()),
                entries.stream().mapToInt(e -> e.getDayLandings() + e.getNightLandings()).sum(),
                entries.size(),
                instrumentUntil,
                ipcOn,
                CalendarMonths.endOfMonthAfter(instrumentUntil, INSTRUMENT_MONTHS),
                window.stream().mapToInt(LogbookEntry::getApproaches).sum(),
                window.stream().anyMatch(LogbookEntry::isHolding),
                window.stream().anyMatch(LogbookEntry::isTracking));
    }

    /** The entries flown in the 6 calendar months preceding `month`. */
    static List<LogbookEntry> inWindow(List<LogbookEntry> entries, YearMonth month) {
        YearMonth from = month.minusMonths(INSTRUMENT_MONTHS);
        return entries.stream().filter(e -> {
            YearMonth flown = YearMonth.from(e.getFlownOn());
            return !flown.isBefore(from) && flown.isBefore(month);
        }).toList();
    }

    /** The last day of instrument currency (61.57(c)(1), (d)): the end of
     *  the latest month whose six preceding months hold six approaches,
     *  holding and tracking, or of the sixth month after an instrument
     *  proficiency check's; null with neither. In the past where it has
     *  lapsed. */
    static LocalDate instrumentUntil(List<LogbookEntry> entries, LocalDate ipcOn) {
        YearMonth best = ipcOn == null ? null : YearMonth.from(ipcOn).plusMonths(INSTRUMENT_MONTHS);
        // Each month a logged flight could have made current: the one after
        // it, up to six after (no month later than that has it in its window).
        List<YearMonth> flown = entries.stream().map(e -> YearMonth.from(e.getFlownOn())).distinct().toList();
        for (YearMonth month : flown) {
            for (int ahead = INSTRUMENT_MONTHS; ahead >= 1; ahead--) {
                YearMonth candidate = month.plusMonths(ahead);
                if (best != null && !candidate.isAfter(best)) {
                    break;
                }
                List<LogbookEntry> window = inWindow(entries, candidate);
                if (window.stream().mapToInt(LogbookEntry::getApproaches).sum() >= APPROACHES
                        && window.stream().anyMatch(LogbookEntry::isHolding)
                        && window.stream().anyMatch(LogbookEntry::isTracking)) {
                    best = candidate;
                    break;
                }
            }
        }
        return best == null ? null : best.atEndOfMonth();
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
