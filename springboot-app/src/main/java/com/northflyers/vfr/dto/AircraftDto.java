package com.northflyers.vfr.dto;

import java.time.Instant;

/** An aeroplane as the API returns it. */
public record AircraftDto(
        Long id,
        String tailNumber,
        String typeDesignator,
        double cruiseTasKt,
        double fuelBurnGph,
        Instant createdAt) {
}
