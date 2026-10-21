package com.northflyers.vfr.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.lang.Nullable;

/** Inbound request body for adding or editing one of a pilot's own
 *  aeroplanes -- POST/PUT /api/aircraft. The cruise power, the climb's
 *  speed and burn and `usableFuelGal` may be left out; given, each must
 *  be positive, and the power one a cruise table has (40 to 100%, the
 *  planner's own limits). The text limits are the columns' own (V3):
 *  longer was a database error, reported as a tail-number clash.
 *
 *  <p>The flight plan's items may be left out too (FAA Form 7233-4, as
 *  AIM Appendix 4 writes them): item 10a's equipment is letters and
 *  figures, since TBL 4-2's codes include E1 to E3, J1 to J7, M1 to M3
 *  and P1 to P9; item 10b's surveillance at most 20 of them (TBL 4-3);
 *  item 19's colour and markings plain words. Blank is none. */
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
        @DecimalMin(value = "40", message = "cruisePowerPct must be between 40 and 100")
        @DecimalMax(value = "100", message = "cruisePowerPct must be between 40 and 100")
        @Nullable Double cruisePowerPct,
        @Positive(message = "climbTasKt must be a positive number")
        @Nullable Double climbTasKt,
        @Positive(message = "climbFuelBurnGph must be a positive number")
        @Nullable Double climbFuelBurnGph,
        @Positive(message = "usableFuelGal must be a positive number")
        @Nullable Double usableFuelGal,
        @Pattern(regexp = "\\s*[A-Za-z0-9]{0,40}\\s*", message = "equipment must be at most 40 letters and figures, as item 10a writes it")
        @Nullable String equipment,
        @Pattern(regexp = "\\s*[A-Za-z0-9]{0,20}\\s*", message = "surveillance must be at most 20 letters and figures, as item 10b writes it")
        @Nullable String surveillance,
        @Size(max = 40, message = "colour must be at most 40 characters")
        @Nullable String colour) {
}
