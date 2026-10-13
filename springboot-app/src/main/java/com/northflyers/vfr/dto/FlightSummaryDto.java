package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.Flight;
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
        Instant createdAt,
        /** The pilot's risk assessment, as saved with it; null without one. */
        @Nullable RiskAssessmentDto risk,
        /** The altitudes the pilot set at its points ("VPBNG:4500"); null
         *  where the planner's own were flown. */
        @Nullable String altitudes) {

    public static FlightSummaryDto of(Flight f) {
        return new FlightSummaryDto(f.getId(), f.getDepartureIdent(), f.getDestinationIdent(), f.getStops(),
                f.getAircraft() == null ? null : f.getAircraft().getTailNumber(),
                f.getCruiseAltitudeFt(), f.getTotalDistanceNm(), f.getTotalEteMin(), f.getTotalFuelGal(),
                f.getPlannedFor(), f.getCreatedAt(), f.getRiskScore() == null ? null : new RiskAssessmentDto(f.getRiskScore(), f.getRiskLevel(), f.getRiskFactors()), f.getOwnAltitudes());
    }
}
