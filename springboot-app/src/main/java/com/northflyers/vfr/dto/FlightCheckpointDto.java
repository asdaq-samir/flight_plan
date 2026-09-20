package com.northflyers.vfr.dto;

/** One line of a filed nav log -- see {@link com.northflyers.vfr.domain.FlightCheckpoint}
 *  for why the leg fields are nullable (the destination row has none,
 *  and an unflyable leg has no groundspeed/ETE/fuel answer), and why
 *  each row carries its own altitude. */
public record FlightCheckpointDto(
        int sequenceNo,
        String name,
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
