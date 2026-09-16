package com.northflyers.vfr.dto;

import java.time.Instant;

/** One row of a pilot's own flight list -- the totals, not the
 *  per-checkpoint detail ({@link FlightDto} carries that, for one
 *  flight at a time). */
public record FlightSummaryDto(
        Long id,
        String departureIdent,
        String destinationIdent,
        String aircraftTailNumber,
        Integer cruiseAltitudeFt,
        Double totalDistanceNm,
        Double totalEteMin,
        Double totalFuelGal,
        Instant plannedFor,
        Instant createdAt) {
}
