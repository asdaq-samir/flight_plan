package com.northflyers.vfr.dto;

import java.time.Instant;
import org.springframework.lang.Nullable;

/** One of a student's instructors: the address asked, and once taken,
 *  the instructor's name and certificate. */
public record InstructorLinkDto(
        Long id,
        String email,
        @Nullable String name,
        @Nullable String certificate,
        boolean accepted,
        Instant askedAt) {
}
