package com.northflyers.vfr.dto;

import java.time.Instant;

/** An aeroplane as the API returns it. `usableFuelGal` is null when
 *  the owner has not said. */
public record AircraftDto(
        Long id,
        String tailNumber,
        String typeDesignator,
        double cruiseTasKt,
        double fuelBurnGph,
        Double usableFuelGal,
        Instant createdAt) {
}
