package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/** The day an endorsement was given -- PUT /api/training/endorsements/{code}. */
public record EndorsementRequest(@NotNull(message = "endorsedOn is required") LocalDate endorsedOn) {
}
