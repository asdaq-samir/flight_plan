package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** A saved flight put to one of the student's instructors for its solo
 *  cross-country review -- POST /api/training/reviews. */
public record AskReviewRequest(
        @NotNull(message = "flightId is required") Long flightId,
        /** The instructor's link (InstructorLinkDto's id), taken. */
        @NotNull(message = "instructorId is required") Long instructorId,
        @NotBlank(message = "makeModel is required") @Size(max = 80, message = "makeModel is at most 80 characters") String makeModel,
        @NotNull(message = "flightOn is required") LocalDate flightOn,
        @Nullable @Size(max = 500, message = "note is at most 500 characters") String note) {
}
