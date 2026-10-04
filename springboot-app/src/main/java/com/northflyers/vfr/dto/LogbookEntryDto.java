package com.northflyers.vfr.dto;

import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** A logbook entry as the API returns it. */
public record LogbookEntryDto(
        Long id,
        LocalDate flownOn,
        @Nullable String aircraft,
        @Nullable String aircraftType,
        @Nullable String route,
        double totalHours,
        double nightHours,
        double crossCountryHours,
        int dayLandings,
        int nightLandings,
        @Nullable String remarks) {
}
