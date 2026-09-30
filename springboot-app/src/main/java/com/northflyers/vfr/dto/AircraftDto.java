package com.northflyers.vfr.dto;

import java.time.Instant;
import org.springframework.lang.Nullable;

/** An aeroplane as the API returns it. The cruise power, the climb's
 *  speed and burn and `usableFuelGal` are null when the owner has not
 *  said. */
public record AircraftDto(
        Long id,
        String tailNumber,
        String typeDesignator,
        double cruiseTasKt,
        double fuelBurnGph,
        @Nullable Double cruisePowerPct,
        @Nullable Double climbTasKt,
        @Nullable Double climbFuelBurnGph,
        @Nullable Double usableFuelGal,
        Instant createdAt) {
}
