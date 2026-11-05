package com.northflyers.wingtip.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.lang.Nullable;

/** How far a student has come with a lesson set them -- POST
 *  /api/training/lessons/{id}/progress, as the lesson goes: its brief
 *  finished, flown to its end, or its quiz as far as it is answered (the
 *  answers so far, of how many questions). What is said once stays: a
 *  lesson briefed is not unbriefed. */
public record LessonProgressRequest(
        boolean briefed,
        boolean flown,
        @Nullable @Valid Quiz quiz) {

    /** The latest attempt at the quiz, its answers in the order asked. */
    public record Quiz(
            @NotNull(message = "answers are required") @Size(max = 40, message = "at most 40 answers")
            List<@Valid @NotNull QuizAnswerDto> answers,
            @Min(value = 1, message = "of is at least 1") @Max(value = 40, message = "of is at most 40") int of) {
    }
}
