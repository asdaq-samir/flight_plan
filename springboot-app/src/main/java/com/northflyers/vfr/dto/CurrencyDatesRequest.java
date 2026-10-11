package com.northflyers.vfr.dto;

import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** The flight review's date, the medical's expiry and the last instrument
 *  proficiency check's date, as the pilot gives them -- PUT
 *  /api/logbook/currency; any may be cleared. */
public record CurrencyDatesRequest(@Nullable LocalDate flightReviewOn, @Nullable LocalDate medicalExpiresOn,
                                   @Nullable LocalDate ipcOn) {
}
