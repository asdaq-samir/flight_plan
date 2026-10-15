package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.CrossCountryReview;
import com.northflyers.vfr.domain.Endorsement;
import com.northflyers.vfr.domain.EndorsementKind;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.SignedEndorsement;
import com.northflyers.vfr.dto.CrossCountryReviewDto;
import com.northflyers.vfr.dto.FlightSummaryDto;
import com.northflyers.vfr.dto.ReviewCheckDto;
import com.northflyers.vfr.dto.SignedEndorsementDto;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * What a student's endorsements say, read the same way for the student's
 * own Checkride page and for their instructor: the day one runs out, the
 * latest held of a kind -- recorded from paper (Endorsement) or signed in
 * the app (SignedEndorsement), a voided one not held -- and what a solo
 * cross-country's review can tell from them.
 */
final class EndorsementRecords {

    /** As AC 61-65K's samples write a date, "12-31-2026". */
    static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("MM-dd-yyyy", Locale.US);
    private static final DateTimeFormatter SAID = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US);

    private EndorsementRecords() {}

    /** The last day it is good for, or null where it does not run out. */
    static LocalDate until(String code, LocalDate on) {
        return EndorsementKind.of(code).map(k -> k.validDays == null ? null : on.plusDays(k.validDays)).orElse(null);
    }

    static SignedEndorsementDto dto(SignedEndorsement e) {
        return new SignedEndorsementDto(e.getId(), e.getCode(), e.getStudentName(), e.getFields(), e.getText(), e.getSignature(),
                e.getSignedOn(), until(e.getCode(), e.getSignedOn()), e.isVoided(), e.getDigest());
    }

    /** A held endorsement: its day, and the make and model it names where
     *  it was signed in the app. */
    record Held(LocalDate on, String makeModel) {
    }

    /** The latest held of any of these codes. */
    static Optional<Held> latest(List<Endorsement> recorded, List<SignedEndorsement> signed, String... codes) {
        List<String> wanted = List.of(codes);
        return Stream.concat(
                recorded.stream().filter(e -> wanted.contains(e.getKey().code())).map(e -> new Held(e.getEndorsedOn(), null)),
                signed.stream().filter(e -> !e.isVoided() && wanted.contains(e.getCode()))
                        .map(e -> new Held(e.getSignedOn(), e.getFields().get("mm"))))
                .max((a, b) -> a.on().compareTo(b.on()));
    }

    /** The day the student's solo endorsement runs out (61.87(n), (p)),
     *  or null with none. */
    static LocalDate soloUntil(List<Endorsement> recorded, List<SignedEndorsement> signed) {
        return latest(recorded, signed, EndorsementKind.SOLO_FIRST.code, EndorsementKind.SOLO_90.code)
                .map(h -> h.on().plusDays(EndorsementKind.SOLO_90.validDays)).orElse(null);
    }

    /**
     * What the student's record answers of 14 CFR 61.93(d) for a solo
     * cross-country on {@code flightOn}: (4) a solo cross-country
     * endorsement, 61.93(c)(1) and (2), and (5) a solo endorsement current
     * on the day, 61.87(n) and (p) -- "within the 90 days preceding the date
     * of the flight". The rest of (d) -- the planning correct, the weather
     * flyable under VFR, the student proficient -- is the instructor's own
     * to determine, and the sheet asks it of them.
     */
    static List<ReviewCheckDto> checks(LocalDate flightOn, List<Endorsement> recorded, List<SignedEndorsement> signed) {
        Optional<Held> xc = latest(recorded, signed, EndorsementKind.SOLO_XC_TRAINING.code);
        Optional<Held> solo = latest(recorded, signed, EndorsementKind.SOLO_FIRST.code, EndorsementKind.SOLO_90.code);
        boolean soloCurrent = solo.map(h -> !h.on().isAfter(flightOn) && !h.on().plusDays(90).isBefore(flightOn)).orElse(false);
        return List.of(
                new ReviewCheckDto("61.93(d)(4)", "A solo cross-country endorsement for the make and model", xc.isPresent(),
                        xc.map(h -> said("Given", h)).orElse("None on record")),
                new ReviewCheckDto("61.93(d)(5)", "A solo endorsement current on the day of the flight", soloCurrent,
                        solo.map(h -> said("Given", h) + (soloCurrent ? "" : ", not within the 90 days before "
                                + SAID.format(flightOn))).orElse("None on record")));
    }

    private static String said(String verb, Held h) {
        return verb + " " + SAID.format(h.on()) + (h.makeModel() == null || h.makeModel().isBlank() ? "" : " for a " + h.makeModel());
    }

    /** The name an endorsement gives a pilot: theirs as their certificate
     *  gives it, else the one they signed in with. */
    static String nameOf(Pilot pilot) {
        return pilot.getFullName() == null || pilot.getFullName().isBlank() ? pilot.getDisplayName() : pilot.getFullName();
    }

    static CrossCountryReviewDto dto(CrossCountryReview r, List<ReviewCheckDto> checks) {
        return new CrossCountryReviewDto(r.getId(), r.getStudent().getId(), nameOf(r.getStudent()), nameOf(r.getInstructor()),
                FlightSummaryDto.of(r.getFlight()), r.getMakeModel(), r.getFlightOn(), r.getNote(), r.getAskedAt(), checks,
                r.getEndorsement() == null ? null : dto(r.getEndorsement()), r.getDeclinedNote(), r.getAnsweredAt());
    }
}
