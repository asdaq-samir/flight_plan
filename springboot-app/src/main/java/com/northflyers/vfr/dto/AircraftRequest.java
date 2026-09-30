package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.lang.Nullable;

/** Inbound request body for adding or editing one of a pilot's own
 *  aeroplanes -- POST/PUT /api/aircraft. The climb's speed and burn and
 *  `usableFuelGal` may be left out; given, each must be positive. The text limits are the columns'
 *  own (V3): longer was a database error, reported as a tail-number
 *  clash. */
public record AircraftRequest(
        @NotBlank(message = "tailNumber is required")
        @Size(max = 16, message = "tailNumber must be at most 16 characters")
        String tailNumber,
        @NotBlank(message = "typeDesignator is required")
        @Size(max = 16, message = "typeDesignator must be at most 16 characters")
        String typeDesignator,
        @Positive(message = "cruiseTasKt must be a positive number")
        double cruiseTasKt,
        @Positive(message = "fuelBurnGph must be a positive number")
        double fuelBurnGph,
        @Positive(message = "climbTasKt must be a positive number")
        @Nullable Double climbTasKt,
        @Positive(message = "climbFuelBurnGph must be a positive number")
        @Nullable Double climbFuelBurnGph,
        @Positive(message = "usableFuelGal must be a positive number")
        @Nullable Double usableFuelGal) {
}
