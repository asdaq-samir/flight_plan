package com.northflyers.vfr.dto;

import java.time.LocalDate;
import org.springframework.lang.Nullable;

/**
 * Where the pilot stands, from the logbook and the two dates they give
 * (see {@code CurrencyService}): the last day they may carry passengers
 * by day and at night, the last day of their flight review's 24
 * calendar months and of their medical -- each null where it cannot be
 * had -- and the logbook's totals.
 */
public record CurrencyDto(
        @Nullable LocalDate dayPassengersUntil,
        @Nullable LocalDate nightPassengersUntil,
        @Nullable LocalDate flightReviewOn,
        @Nullable LocalDate flightReviewUntil,
        @Nullable LocalDate medicalExpiresOn,
        double totalHours,
        double nightHours,
        double crossCountryHours,
        int landings,
        int flights) {
}
