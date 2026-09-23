package com.northflyers.vfr.dto;

import java.time.Instant;
import org.springframework.lang.Nullable;

/** An aeroplane as the API returns it. `usableFuelGal` is null when
 *  the owner has not said. */
public record AircraftDto(
        Long id,
        String tailNumber,
        String typeDesignator,
        double cruiseTasKt,
        double fuelBurnGph,
        @Nullable Double usableFuelGal,
        Instant createdAt) {
}
