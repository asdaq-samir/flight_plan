package com.northflyers.vfr.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * A pilot as the API returns them.
 *
 * <p>Deliberately not the entity: {@code googleSubject} is an
 * authentication detail and never leaves the server, and a DTO is what
 * keeps that a compile-time fact rather than a habit.
 */
@Schema(description = "The signed-in pilot")
public record PilotDto(
        @Schema(description = "Internal id", example = "1") Long id,
        @Schema(description = "Email address from the identity provider", example = "pilot@example.com") String email,
        @Schema(description = "Display name", example = "A. Pilot") String displayName,
        @Schema(description = "Whether this pilot also does development work here: the training workspace "
                + "and the developer console are theirs, a plain pilot's are not.",
                example = "false") boolean developer) {
}
