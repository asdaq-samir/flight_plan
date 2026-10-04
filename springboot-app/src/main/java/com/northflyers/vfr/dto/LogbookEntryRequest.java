package com.northflyers.vfr.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** A logbook entry as its form sends it -- POST/PUT /api/logbook. The
 *  hours and landings are none or more; the text no longer than its
 *  columns (V12). */
public record LogbookEntryRequest(
        @NotNull(message = "flownOn is required") LocalDate flownOn,
        @Size(max = 16, message = "aircraft must be at most 16 characters") @Nullable String aircraft,
        @Size(max = 16, message = "aircraftType must be at most 16 characters") @Nullable String aircraftType,
        @Size(max = 120, message = "route must be at most 120 characters") @Nullable String route,
        @PositiveOrZero(message = "totalHours must be zero or more") @Max(value = 24, message = "totalHours must be a day at most")
        double totalHours,
        @PositiveOrZero(message = "nightHours must be zero or more") double nightHours,
        @PositiveOrZero(message = "crossCountryHours must be zero or more") double crossCountryHours,
        @PositiveOrZero(message = "dayLandings must be zero or more") int dayLandings,
        @PositiveOrZero(message = "nightLandings must be zero or more") int nightLandings,
        @Size(max = 500, message = "remarks must be at most 500 characters") @Nullable String remarks) {
}
