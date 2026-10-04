package com.northflyers.vfr.dto;

import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** The flight review's date and the medical's expiry, as the pilot gives
 *  them -- PUT /api/logbook/currency; either may be cleared. */
public record CurrencyDatesRequest(@Nullable LocalDate flightReviewOn, @Nullable LocalDate medicalExpiresOn) {
}
