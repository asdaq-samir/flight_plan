package com.northflyers.vfr.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A scored waypoint candidate. snake_case JsonProperty mappings match
 * model-service's (Python/FastAPI) response field names -- this same
 * record is also what gets serialized into the routes.checkpoints jsonb
 * column, so the DB stores exactly what model-service returned.
 */
public record Checkpoint(
        @JsonProperty("osm_id") String osmId,
        String category,
        String name,
        double lat,
        double lon,
        @JsonProperty("along_track_nm") double alongTrackNm,
        @JsonProperty("predicted_score") double predictedScore) {
}
