package com.northflyers.vfr.dto;

import java.time.Instant;
import java.util.List;
import org.springframework.lang.Nullable;

/** One row of a pilot's own flight list -- the totals, not the
 *  per-checkpoint detail ({@link FlightDto} carries that, for one
 *  flight at a time). */
public record FlightSummaryDto(
        Long id,
        String departureIdent,
        String destinationIdent,
        /** The airports it lands at on the way, in order. */
        List<String> stops,
        @Nullable String aircraftTailNumber,
        @Nullable Integer cruiseAltitudeFt,
        @Nullable Double totalDistanceNm,
        @Nullable Double totalEteMin,
        @Nullable Double totalFuelGal,
        @Nullable Instant plannedFor,
        Instant createdAt) {
}
