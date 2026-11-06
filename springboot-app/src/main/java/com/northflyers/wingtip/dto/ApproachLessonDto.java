package com.northflyers.wingtip.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.lang.Nullable;

/** An approach set as a lesson, as its student or its instructor reads
 *  it: the approach, who set it, their note at each fix, the day it is
 *  due, the student's progress -- "not-started", "briefed", "flown" or
 *  "quizzed", each later one the further -- and their latest quiz. For
 *  the instructor, `flights` are the student's flights put to them (a
 *  solo cross-country's review) that land at the field with a track
 *  saved, newest first, whose track their app debriefs against the
 *  approach; for the student, none. */
public record ApproachLessonDto(
        Long id,
        Long studentId,
        String studentName,
        String instructorName,
        String airportIdent,
        String procedureId,
        String procedureName,
        @Nullable String cycle,
        Map<String, String> fixNotes,
        @Nullable LocalDate dueOn,
        Instant createdAt,
        Instant updatedAt,
        String status,
        @Nullable Instant briefedAt,
        @Nullable Instant flownAt,
        List<QuizAnswerDto> quizAnswers,
        @Nullable Integer quizOf,
        @Nullable Instant quizAt,
        List<FlightSummaryDto> flights) {
}
