package com.northflyers.vfr.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A scored waypoint candidate, as returned by model-service's
 * POST /invocations. Persisted as a {@link com.northflyers.vfr.domain.Checkpoint}
 * entity, not stored directly -- see that class for the normalized schema.
 */
public record CheckpointDto(
        @JsonProperty("osm_id") String osmId,
        String category,
        String name,
        double lat,
        double lon,
        @JsonProperty("along_track_nm") double alongTrackNm,
        @JsonProperty("predicted_score") double predictedScore) {
}
