package com.northflyers.vfr.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import org.springframework.lang.Nullable;

/** Inbound request body for POST /api/flights -- files a new flight, with
 *  its nav log, for a route this pilot planned; every POST is another
 *  flight, never a replacement of an earlier one.
 *  {@link com.northflyers.vfr.domain.Flight#fileNavLog} replaces a
 *  flight's own nav log, which a new flight has none of yet. {@code
 *  aircraftId} is optional: a flight can be filed without a saved
 *  aircraft, the same way {@link com.northflyers.vfr.domain.Flight}
 *  itself allows it to be null. */
public record SaveFlightRequest(
        @Nullable Long aircraftId,
        @NotBlank(message = "departureIdent is required")
        @Pattern(regexp = "[A-Za-z0-9]{3,4}", message = "departureIdent must be a 3-4 character airport ident")
        String departureIdent,
        @NotBlank(message = "destinationIdent is required")
        @Pattern(regexp = "[A-Za-z0-9]{3,4}", message = "destinationIdent must be a 3-4 character airport ident")
        String destinationIdent,
        @Nullable Integer cruiseAltitudeFt,
        @Nullable Double totalDistanceNm,
        @Nullable Double totalEteMin,
        @Nullable Double totalFuelGal,
        @Nullable Instant plannedFor,
        @Valid
        List<SaveFlightCheckpointRequest> checkpoints,
        /** The airports landed at on the way, in order; null or empty
         *  for a flight flown straight. */
        @Nullable
        @Size(max = 8, message = "a flight makes at most 8 stops")
        List<@Pattern(regexp = "[A-Za-z0-9]{2,5}", message = "a stop must be a 2-5 character airport or waypoint ident") String> stops,
        /** The pilot's risk assessment for it, where the planner made one. */
        @Nullable @Valid RiskAssessmentDto risk,
        /** The altitudes the pilot set at points of the route, as the
         *  planner's `altitudes` parameter writes them: "VPBNG:4500,KDLH:2400",
         *  ten at most. Null or blank for none. */
        @Nullable
        @Pattern(regexp = "^$|[A-Za-z0-9]{2,5}:\\d{1,5}(,[A-Za-z0-9]{2,5}:\\d{1,5}){0,9}",
                message = "altitudes must be IDENT:feet pairs joined by commas, ten at most")
        String altitudes) {
}
