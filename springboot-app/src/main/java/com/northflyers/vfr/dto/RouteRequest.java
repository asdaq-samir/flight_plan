package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Inbound request body to this app's own POST /api/routes. */
public record RouteRequest(
        @NotBlank(message = "departureIdent is required")
        @Pattern(regexp = "[A-Za-z0-9]{3,4}", message = "departureIdent must be a 3-4 character airport ident")
        String departureIdent,
        @NotBlank(message = "destinationIdent is required")
        @Pattern(regexp = "[A-Za-z0-9]{3,4}", message = "destinationIdent must be a 3-4 character airport ident")
        String destinationIdent) {
}
