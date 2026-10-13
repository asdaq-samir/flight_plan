package com.northflyers.vfr.dto;

import java.time.Instant;
import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** One of an instructor's students, or a student asking to be: their
 *  name, how far along 61.109's experience they are, the day their solo
 *  endorsement runs out, and the reviews they are waiting on. */
public record StudentDto(
        Long linkId,
        Long studentId,
        String name,
        String email,
        Instant askedAt,
        boolean accepted,
        int experienceMet,
        int experienceOf,
        @Nullable LocalDate soloUntil,
        int reviewsWaiting) {
}
