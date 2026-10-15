package com.northflyers.vfr.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.lang.Nullable;

/** A solo cross-country put to an instructor (14 CFR 61.93(c)(3), (d)):
 *  the flight as saved, the airplane and day, the student's note, the
 *  record's answer to what (d) asks, and the answer once given. */
public record CrossCountryReviewDto(
        Long id,
        @Nullable Long studentId,
        String studentName,
        @Nullable String instructorName,
        FlightSummaryDto flight,
        String makeModel,
        LocalDate flightOn,
        @Nullable String note,
        Instant askedAt,
        List<ReviewCheckDto> checks,
        @Nullable SignedEndorsementDto endorsement,
        @Nullable String declinedNote,
        @Nullable Instant answeredAt) {
}
