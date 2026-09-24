package com.northflyers.vfr.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
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
        List<SaveFlightCheckpointRequest> checkpoints) {
}
