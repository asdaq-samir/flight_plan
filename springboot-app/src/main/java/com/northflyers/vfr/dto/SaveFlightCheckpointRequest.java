package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;

/** One line of the nav log a POST /api/flights body files -- the leg
 *  fields are nullable for the same reasons the entity's are (see
 *  {@link com.northflyers.vfr.domain.FlightCheckpoint}); `altitudeFt`
 *  is the altitude of the leg arriving here, which a stepped plan
 *  varies row by row. */
public record SaveFlightCheckpointRequest(
        int sequenceNo,
        @NotBlank(message = "name is required")
        String name,
        @NotBlank(message = "category is required")
        String category,
        double lat,
        double lon,
        double alongTrackNm,
        Double legDistanceNm,
        Double trueCourseDeg,
        Double magneticHeadingDeg,
        Double groundspeedKt,
        Double eteMin,
        Double fuelGal,
        Double altitudeFt) {
}
