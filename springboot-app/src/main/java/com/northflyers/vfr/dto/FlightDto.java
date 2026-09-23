package com.northflyers.vfr.dto;

import java.time.Instant;
import java.util.List;
import org.springframework.lang.Nullable;

/** One flight in full, including the nav log filed for it -- what
 *  GET /api/flights/{id} returns; the list endpoint returns
 *  {@link FlightSummaryDto} instead, since a list of full nav logs is
 *  more than a "my flights" view needs. */
public record FlightDto(
        Long id,
        String departureIdent,
        String destinationIdent,
        @Nullable String aircraftTailNumber,
        @Nullable Integer cruiseAltitudeFt,
        @Nullable Double totalDistanceNm,
        @Nullable Double totalEteMin,
        @Nullable Double totalFuelGal,
        @Nullable Instant plannedFor,
        Instant createdAt,
        List<FlightCheckpointDto> checkpoints) {
}
