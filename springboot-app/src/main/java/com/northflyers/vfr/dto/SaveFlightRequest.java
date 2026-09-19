package com.northflyers.vfr.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.time.Instant;
import java.util.List;

/** Inbound request body for POST /api/flights -- files (replacing any
 *  previous one, per {@link com.northflyers.vfr.domain.Flight#fileNavLog})
 *  a nav log for a route this pilot planned. {@code aircraftId} is
 *  optional: a flight can be filed without a saved aircraft, the same way
 *  {@link com.northflyers.vfr.domain.Flight} itself allows it to be null. */
public record SaveFlightRequest(
        Long aircraftId,
        @NotBlank(message = "departureIdent is required")
        @Pattern(regexp = "[A-Za-z0-9]{3,4}", message = "departureIdent must be a 3-4 character airport ident")
        String departureIdent,
        @NotBlank(message = "destinationIdent is required")
        @Pattern(regexp = "[A-Za-z0-9]{3,4}", message = "destinationIdent must be a 3-4 character airport ident")
        String destinationIdent,
        Integer cruiseAltitudeFt,
        Double totalDistanceNm,
        Double totalEteMin,
        Double totalFuelGal,
        Instant plannedFor,
        @Valid
        List<SaveFlightCheckpointRequest> checkpoints) {
}
