package com.northflyers.wingtip.dto;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/** Inbound request body for POST /api/flights/{id}/watch: when the
 *  flight departs, which the watch runs up to. */
public record WatchFlightRequest(
        @NotNull(message = "departAt is required")
        Instant departAt) {
}
