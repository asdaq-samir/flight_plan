package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** The pilot's name as their certificate gives it -- PUT /api/training/name. */
public record FullNameRequest(
        @NotBlank(message = "fullName is required") @Size(max = 120, message = "fullName is at most 120 characters") String fullName) {
}
