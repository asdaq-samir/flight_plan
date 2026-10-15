package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.InstructorUntil;
import java.time.LocalDate;
import java.util.List;
import org.springframework.lang.Nullable;

/** A pilot as a flight instructor: their certificate as endorsements
 *  carry it, their students, the students asking, the reviews waiting,
 *  and what they have signed in the last 3 years -- the record 14 CFR
 *  61.189(b) and (c) ask them to keep. */
public record InstructorDto(
        @Nullable String fullName,
        @Nullable String certificate,
        @Nullable LocalDate until,
        @Nullable InstructorUntil untilKind,
        List<StudentDto> students,
        List<StudentDto> asking,
        List<CrossCountryReviewDto> reviews,
        List<SignedEndorsementDto> signed,
        List<EndorsementKindDto> kinds) {
}
