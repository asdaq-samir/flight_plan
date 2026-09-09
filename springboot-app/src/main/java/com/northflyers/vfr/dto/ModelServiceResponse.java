package com.northflyers.vfr.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** Response body from model-service's POST /invocations. */
public record ModelServiceResponse(
        @JsonProperty("departure_ident") String departureIdent,
        @JsonProperty("destination_ident") String destinationIdent,
        List<CheckpointDto> checkpoints,
        boolean stub) {
}
