package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** A solo cross-country turned down, and why -- POST
 *  /api/instructor/reviews/{id}/decline. */
public record DeclineRequest(
        @NotBlank(message = "note is required") @Size(max = 500, message = "note is at most 500 characters") String note) {
}
