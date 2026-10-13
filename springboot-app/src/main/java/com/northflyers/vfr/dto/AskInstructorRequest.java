package com.northflyers.vfr.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** An instructor asked in, by address -- POST /api/training/instructors. */
public record AskInstructorRequest(
        @NotBlank(message = "email is required") @Email(message = "email must be an address")
        @Size(max = 320, message = "email is at most 320 characters") String email) {
}
