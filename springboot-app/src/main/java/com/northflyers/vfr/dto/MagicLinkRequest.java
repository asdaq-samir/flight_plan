package com.northflyers.vfr.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Inbound request body for starting a magic-link sign-in -- POST
 *  /api/auth/magic-link. */
public record MagicLinkRequest(
        @NotBlank(message = "email is required")
        @Email(message = "email must be a valid address")
        @Size(max = 320, message = "email must be at most 320 characters")
        String email) {
}
