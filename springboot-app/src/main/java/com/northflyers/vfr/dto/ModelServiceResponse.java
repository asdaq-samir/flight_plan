package com.northflyers.vfr.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.northflyers.vfr.domain.Checkpoint;
import java.util.List;

/** Response body from model-service's POST /invocations. */
public record ModelServiceResponse(
        @JsonProperty("departure_ident") String departureIdent,
        @JsonProperty("destination_ident") String destinationIdent,
        List<Checkpoint> checkpoints,
        boolean stub) {
}
