package com.northflyers.vfr.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/** A flight's risk assessment (the planner's FRAT) as the pilot saw it
 *  when they saved the flight: its points, where they put it, and what
 *  raised them, each in a few words. In a {@link SaveFlightRequest} and
 *  back out in the flight's own DTOs alike. */
public record RiskAssessmentDto(
        @Min(value = 0, message = "score must not be negative")
        @Max(value = 500, message = "score must be at most 500")
        int score,
        @NotNull(message = "level is required")
        @Pattern(regexp = "low|caution|high", message = "level must be low, caution or high")
        String level,
        @NotNull(message = "factors is required")
        @Size(max = 24, message = "at most 24 factors")
        List<@Size(max = 80, message = "a factor must be at most 80 characters") @Pattern(regexp = "[^\\n]*", message = "a factor is one line") String> factors) {
}
