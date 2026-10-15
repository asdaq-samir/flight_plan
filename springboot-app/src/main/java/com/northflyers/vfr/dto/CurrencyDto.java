package com.northflyers.vfr.dto;

import java.time.LocalDate;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.lang.Nullable;

/**
 * Where the pilot stands, from the logbook and the two dates they give
 * (see {@code CurrencyService}): the last day they may carry passengers
 * by day and at night, the last day of their flight review's 24
 * calendar months and of their medical -- each null where it cannot be
 * had -- the logbook's totals, and their instrument currency.
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
        int flights,
        @Schema(description = "The last day of instrument currency (14 CFR 61.57(c)(1), or 61.57(d)'s check); in the "
                + "past where it has lapsed, null where none is logged")
        @Nullable LocalDate instrumentCurrentUntil,
        @Schema(description = "The last instrument proficiency check, as the pilot gives it")
        @Nullable LocalDate ipcOn,
        @Schema(description = "The day after which only an instrument proficiency check restores it (61.57(d))")
        @Nullable LocalDate ipcNeededAfter,
        @Schema(description = "Approaches logged in the 6 calendar months before this one")
        int approachesInWindow,
        @Schema(description = "Holding logged in them") boolean holdingInWindow,
        @Schema(description = "Intercepting and tracking courses logged in them") boolean trackingInWindow) {
}
