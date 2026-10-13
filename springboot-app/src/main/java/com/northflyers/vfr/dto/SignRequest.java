package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.lang.Nullable;

/** An endorsement signed for a student -- POST
 *  /api/instructor/students/{studentId}/endorsements: the fields filled
 *  in, the words the instructor read before signing (refused where they
 *  are not what the fields make), their own day, and the review it
 *  answers, if one. */
public record SignRequest(
        @NotBlank(message = "code is required") String code,
        @NotNull(message = "fields are required") Map<String, @Size(max = 300, message = "a field is at most 300 characters") String> fields,
        @NotBlank(message = "text is required") @Size(max = 2000, message = "text is at most 2000 characters") String text,
        @NotNull(message = "signedOn is required") LocalDate signedOn,
        @Nullable Long reviewId) {
}
