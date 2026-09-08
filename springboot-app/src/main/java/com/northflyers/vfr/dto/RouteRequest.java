package com.northflyers.vfr.dto;

/** Inbound request body to this app's own POST /api/routes. */
public record RouteRequest(String departureIdent, String destinationIdent) {
}
