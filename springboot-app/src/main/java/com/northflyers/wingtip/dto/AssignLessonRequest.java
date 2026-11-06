package com.northflyers.wingtip.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.lang.Nullable;

/** An approach set as a lesson for one of the instructor's students --
 *  POST /api/instructor/students/{studentId}/lessons: the approach as the
 *  planner's procedures name it (lib/procedures' shapes: the field's
 *  identifier, the procedure's id), its name as the plate titles it and
 *  the cycle it was picked in, a note at any of its fixes, and a day to
 *  have it done by. */
public record AssignLessonRequest(
        @NotBlank(message = "airportIdent is required")
        @Pattern(regexp = "^[A-Za-z0-9]{2,5}$", message = "airportIdent is an airport's identifier") String airportIdent,
        @NotBlank(message = "procedureId is required")
        @Pattern(regexp = "^[A-Za-z0-9-]{1,6}$", message = "procedureId is a procedure's id, as I09") String procedureId,
        @NotBlank(message = "procedureName is required")
        @Size(max = 80, message = "procedureName is at most 80 characters") String procedureName,
        @Nullable @Pattern(regexp = "^[0-9]{4,8}$", message = "cycle is the procedures' cycle, as 261029") String cycle,
        @NotNull(message = "fixNotes are required")
        @Size(max = 40, message = "at most 40 notes")
        Map<@Pattern(regexp = "^[A-Za-z0-9]{1,8}$", message = "a note's fix is a fix's identifier") String,
                @Size(max = 300, message = "a note is at most 300 characters") String> fixNotes,
        @Nullable LocalDate dueOn) {
}
