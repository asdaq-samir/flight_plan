package com.northflyers.wingtip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** A quiz question of the approach lesson answered: the question as it
 *  was asked, the choice made, and whether it was the right one. */
public record QuizAnswerDto(
        @NotBlank(message = "question is required") @Size(max = 300, message = "question is at most 300 characters") String question,
        @NotBlank(message = "chosen is required") @Size(max = 200, message = "chosen is at most 200 characters") String chosen,
        boolean right) {
}
