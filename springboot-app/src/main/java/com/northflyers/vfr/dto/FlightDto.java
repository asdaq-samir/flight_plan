package com.northflyers.vfr.dto;

import java.time.Instant;
import java.util.List;

/** One flight in full, including the nav log filed for it -- what
 *  GET /api/flights/{id} returns; the list endpoint returns
 *  {@link FlightSummaryDto} instead, since a list of full nav logs is
 *  more than a "my flights" view needs. */
public record FlightDto(
        Long id,
        String departureIdent,
        String destinationIdent,
        String aircraftTailNumber,
        Integer cruiseAltitudeFt,
        Double totalDistanceNm,
        Double totalEteMin,
        Double totalFuelGal,
        Instant plannedFor,
        Instant createdAt,
        List<FlightCheckpointDto> checkpoints) {
}
