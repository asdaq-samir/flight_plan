package com.northflyers.vfr.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import org.springframework.lang.Nullable;

/** One point of a flown track: when (ms since the epoch), where, and its
 *  GPS altitude in feet above sea level where the file had one. */
public record TrackPointDto(
        long t,
        @DecimalMin(value = "-90", message = "lat must be at least -90") @DecimalMax(value = "90", message = "lat must be at most 90")
        double lat,
        @DecimalMin(value = "-180", message = "lon must be at least -180") @DecimalMax(value = "180", message = "lon must be at most 180")
        double lon,
        @Nullable Double altFt) {
}
