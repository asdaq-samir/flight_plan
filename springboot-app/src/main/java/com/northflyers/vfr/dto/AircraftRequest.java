package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import org.springframework.lang.Nullable;

/** Inbound request body for adding or editing one of a pilot's own
 *  aeroplanes -- POST/PUT /api/aircraft. `usableFuelGal` may be left
 *  out; given, it must be positive. */
public record AircraftRequest(
        @NotBlank(message = "tailNumber is required")
        String tailNumber,
        @NotBlank(message = "typeDesignator is required")
        String typeDesignator,
        @Positive(message = "cruiseTasKt must be a positive number")
        double cruiseTasKt,
        @Positive(message = "fuelBurnGph must be a positive number")
        double fuelBurnGph,
        @Positive(message = "usableFuelGal must be a positive number")
        @Nullable Double usableFuelGal) {
}
