package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.lang.Nullable;

/** One line of the nav log a POST /api/flights body files -- the leg
 *  fields are nullable for the same reasons the entity's are (see
 *  {@link com.northflyers.vfr.domain.FlightCheckpoint}); `altitudeFt`
 *  is the altitude of the leg arriving here, which a stepped plan
 *  varies row by row. */
public record SaveFlightCheckpointRequest(
        int sequenceNo,
        @NotBlank(message = "name is required")
        @Size(max = 255, message = "name must be at most 255 characters")
        String name,
        @NotBlank(message = "category is required")
        @Size(max = 64, message = "category must be at most 64 characters")
        String category,
        double lat,
        double lon,
        double alongTrackNm,
        @Nullable Double legDistanceNm,
        @Nullable Double trueCourseDeg,
        @Nullable Double magneticHeadingDeg,
        @Nullable Double groundspeedKt,
        @Nullable Double eteMin,
        @Nullable Double fuelGal,
        @Nullable Double altitudeFt) {
}
