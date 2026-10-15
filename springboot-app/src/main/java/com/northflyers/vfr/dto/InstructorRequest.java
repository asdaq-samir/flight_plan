package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.InstructorUntil;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** A pilot's flight instructor certificate as endorsements print it --
 *  PUT /api/instructor. */
public record InstructorRequest(
        @NotBlank(message = "fullName is required") @Size(max = 120, message = "fullName is at most 120 characters") String fullName,
        /** As the FAA prints it with its ratings' letters, "987654321CFI". */
        @NotBlank(message = "certificate is required")
        @Pattern(regexp = "[A-Za-z0-9]{4,20}", message = "certificate must be 4 to 20 letters and digits")
        String certificate,
        @NotNull(message = "until is required") LocalDate until,
        @NotNull(message = "untilKind is required") InstructorUntil untilKind) {
}
