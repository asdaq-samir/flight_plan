package com.northflyers.vfr.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Outbound request body to model-service's POST /invocations. */
public record ModelServiceRequest(
        @JsonProperty("departure_ident") String departureIdent,
        @JsonProperty("destination_ident") String destinationIdent) {
}
