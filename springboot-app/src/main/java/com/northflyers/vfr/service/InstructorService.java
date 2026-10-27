package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.CrossCountryReview;
import com.northflyers.vfr.domain.Endorsement;
import com.northflyers.vfr.domain.EndorsementKind;
import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.InstructorLink;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.SignedEndorsement;
import com.northflyers.vfr.dto.AskReviewRequest;
import com.northflyers.vfr.dto.CrossCountryReviewDto;
import com.northflyers.vfr.dto.EndorsementKindDto;
import com.northflyers.vfr.dto.InstructorDto;
import com.northflyers.vfr.dto.InstructorRequest;
import com.northflyers.vfr.dto.SignRequest;
import com.northflyers.vfr.dto.StudentDto;
import com.northflyers.vfr.repository.CrossCountryReviewRepository;
import com.northflyers.vfr.repository.EndorsementRepository;
import com.northflyers.vfr.repository.FlightRepository;
import com.northflyers.vfr.repository.InstructorLinkRepository;
import com.northflyers.vfr.repository.LogbookRepository;
import com.northflyers.vfr.repository.PilotRepository;
import com.northflyers.vfr.repository.SignedEndorsementRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import org.hibernate.Hibernate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Flight instructors and their students. A student asks an instructor in
 * by address; whoever signs in with that address takes it, and from then
 * sees the student's way to the checkride, the solo cross-countries put to
 * them, and signs endorsements in the app from AC 61-65K's samples.
 *
 * <p>A signature, as AC 120-78B (December 2024) describes one, which 14
 * CFR part 61 asks no approval of (its 1.9.5) but recommends following:
 * the instructor signed in -- their account under their sole control, the
 * address theirs (2.1.2.2, 2.1.2.3); the words read before signing, and
 * signed only if they are what the fields make (2.2.4); the signature
 * line AC 61-65K asks of every endorsement -- signature, date, certificate
 * number and recent experience or expiration date; nothing changed once
 * signed, a correction voiding it for a new one (2.2.7, 2.2.8); and both
 * told by email that it was signed (2.2.3). An instructor whose recent
 * experience has run out (61.197(a)) or whose pre-December 2024
 * certificate has expired (61.19(d)(2), 61.197(e)) may not exercise its
 * privileges, but the app warns and never refuses (the owner's rule,
 * 2026-10-26): the screens say so before signing, and the signature line
 * carries the date, so the record shows it was past.
 */
@Service
public class InstructorService {

    private static final Logger log = LoggerFactory.getLogger(InstructorService.class);

    /** How long an instructor keeps the record of what they signed:
     *  "at least 3 years" (14 CFR 61.189(c)). */
    static final int RECORD_YEARS = 3;
    /** Instructors a student may ask in a day: each ask is an email to an
     *  address of the student's choosing. */
    static final int ASKS_A_DAY = 5;

    private final PilotRepository pilots;
    private final InstructorLinkRepository links;
    private final SignedEndorsementRepository signed;
    private final CrossCountryReviewRepository reviews;
    private final EndorsementRepository recorded;
    private final FlightRepository flights;
    private final LogbookRepository logbook;
    private final Mailer mail;
    private final String publicBaseUrl;

    public InstructorService(PilotRepository pilots, InstructorLinkRepository links, SignedEndorsementRepository signed,
                             CrossCountryReviewRepository reviews, EndorsementRepository recorded, FlightRepository flights,
                             LogbookRepository logbook, Mailer mail, @Value("${app.public-base-url:}") String publicBaseUrl) {
        this.pilots = pilots;
        this.links = links;
        this.signed = signed;
        this.reviews = reviews;
        this.recorded = recorded;
        this.flights = flights;
        this.logbook = logbook;
        this.mail = mail;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    /** A request refused, with the status and the words to answer it with. */
    public static class Refused extends RuntimeException {
        public final HttpStatus status;

        public Refused(HttpStatus status, String why) {
            super(why);
            this.status = status;
        }
    }

    // ---- The student's side

    @Transactional
    public void setFullName(Pilot pilot, String fullName) {
        pilot.setFullName(fullName.strip().replaceAll("\\s+", " "));
        pilots.save(pilot);
    }

    /** An instructor asked in by address, and emailed. */
    @Transactional
    public void ask(Pilot student, String email, Instant now) {
        String address = email.strip();
        if (address.equalsIgnoreCase(student.getEmail())) {
            throw new Refused(HttpStatus.BAD_REQUEST, "That is your own address: ask your instructor's.");
        }
        if (links.existsByStudentIdAndEmailIgnoreCase(student.getId(), address)) {
            throw new Refused(HttpStatus.CONFLICT, "You have already asked " + address + ".");
        }
        if (links.countByStudentIdAndAskedAtAfter(student.getId(), now.minus(Duration.ofDays(1))) >= ASKS_A_DAY) {
            throw new Refused(HttpStatus.TOO_MANY_REQUESTS, "You have asked " + ASKS_A_DAY + " instructors today: ask again tomorrow.");
        }
        links.save(new InstructorLink(student, address, now));
        String name = EndorsementRecords.nameOf(student);
        send(address, name + " asks you to be their flight instructor",
                name + " (" + student.getEmail() + ") has asked you to be their flight instructor in Wingtip Maps: to see their"
                        + " way to the checkride, review the planning of their solo cross-countries and sign their endorsements"
                        + " there.\n\nTo answer, sign in to Wingtip Maps with this address (" + address + ") and open Logbook, then"
                        + " Students." + openLine());
    }

    /** @return false where the student has no such instructor */
    @Transactional
    public boolean drop(Pilot student, Long linkId) {
        return links.findById(linkId).filter(l -> l.getStudent().getId().equals(student.getId())).map(l -> {
            end(l);
            return true;
        }).orElse(false);
    }

    /** A saved flight put to one of the student's instructors, who is
     *  emailed. */
    @Transactional
    public void askReview(Pilot student, AskReviewRequest request, Instant now) {
        InstructorLink link = links.findById(request.instructorId())
                .filter(l -> l.getStudent().getId().equals(student.getId()) && l.isAccepted())
                .orElseThrow(() -> new Refused(HttpStatus.NOT_FOUND, "That instructor has not taken you on yet."));
        Flight flight = flights.findByIdAndPilotId(request.flightId(), student.getId())
                .orElseThrow(() -> new Refused(HttpStatus.NOT_FOUND, "No such flight of yours."));
        Pilot instructor = link.getInstructor();
        boolean waiting = reviews.findByStudentIdAndInstructorIdOrderByAskedAtDesc(student.getId(), instructor.getId()).stream()
                .anyMatch(r -> !r.isAnswered() && r.getFlight().getId().equals(flight.getId()));
        if (waiting) {
            throw new Refused(HttpStatus.CONFLICT, "This flight is already with " + EndorsementRecords.nameOf(instructor) + ".");
        }
        String note = Typed.text(request.note());
        reviews.save(new CrossCountryReview(student, instructor, flight, request.makeModel().strip(), request.flightOn(), note, now));
        String name = EndorsementRecords.nameOf(student);
        send(instructor.getEmail(), name + " asks you to review a solo cross-country",
                name + " asks you to review the planning of their solo cross-country, "
                        + String.join(" ", route(flight)) + " in a " + request.makeModel().strip() + " on "
                        + EndorsementRecords.DAY.format(request.flightOn()) + " (14 CFR 61.93(c)(3)).\n"
                        + (note == null ? "" : "\n\"" + note + "\"\n")
                        + "\nOpen Logbook, then Students, in Wingtip Maps to review it." + openLine());
    }

    /** @return false where there is no such review of the student's still
     *  waiting */
    @Transactional
    public boolean withdrawReview(Pilot student, Long reviewId) {
        return reviews.findById(reviewId)
                .filter(r -> r.getStudent().getId().equals(student.getId()) && !r.isAnswered())
                .map(r -> {
                    reviews.delete(r);
                    return true;
                }).orElse(false);
    }

    // ---- The instructor's side

    @Transactional
    public void setInstructor(Pilot pilot, InstructorRequest request) {
        pilot.setFullName(request.fullName().strip().replaceAll("\\s+", " "));
        pilot.setInstructor(request.certificate().strip().toUpperCase(Locale.ROOT), request.until(), request.untilKind());
        pilots.save(pilot);
    }

    /** No longer an instructor here: what they signed stays signed, and
     *  their students stay theirs until either ends it. */
    @Transactional
    public void stopInstructing(Pilot pilot) {
        pilot.setInstructor(null, null, null);
        pilots.save(pilot);
    }

    /** A student's ask taken, where it was made of this pilot's address.
     *  @return false where there is no such ask */
    @Transactional
    public boolean accept(Pilot instructor, Long linkId, Instant now) {
        Optional<InstructorLink> ask = links.findById(linkId)
                .filter(l -> !l.isAccepted() && l.getEmail().equalsIgnoreCase(instructor.getEmail()));
        ask.ifPresent(l -> {
            // Asked at two of the instructor's addresses, say: one is enough.
            if (links.findByStudentIdAndInstructorId(l.getStudent().getId(), instructor.getId()).isPresent()) {
                links.delete(l);
            } else {
                l.accept(instructor, now);
            }
        });
        return ask.isPresent();
    }

    /** An ask turned down, or a student given up.
     *  @return false where there is no such ask or student */
    @Transactional
    public boolean leave(Pilot instructor, Long linkId) {
        return links.findById(linkId).filter(l -> l.isAccepted()
                        ? l.getInstructor().getId().equals(instructor.getId())
                        : l.getEmail().equalsIgnoreCase(instructor.getEmail()))
                .map(l -> {
                    end(l);
                    return true;
                }).orElse(false);
    }

    /** One of the instructor's students, loaded: read after this
     *  transaction, by the record and the signature. */
    @Transactional(readOnly = true)
    public Optional<Pilot> student(Pilot instructor, Long studentId) {
        return links.findByStudentIdAndInstructorId(studentId, instructor.getId()).map(l -> (Pilot) Hibernate.unproxy(l.getStudent()));
    }

    /** The endorsement signed, and the student and the instructor emailed it. */
    @Transactional
    public SignedEndorsement sign(Pilot instructor, Pilot student, SignRequest request, Instant now) {
        if (!instructor.isInstructor() || instructor.getFullName() == null) {
            throw new Refused(HttpStatus.CONFLICT, "Give your flight instructor certificate before signing.");
        }
        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);
        // The instructor's own day, which west of Greenwich is a day behind
        // UTC's in the evening.
        if (request.signedOn().isBefore(today.minusDays(1)) || request.signedOn().isAfter(today.plusDays(1))) {
            throw new Refused(HttpStatus.BAD_REQUEST, "An endorsement is signed with today's date.");
        }
        if (student.getFullName() == null || student.getFullName().isBlank()) {
            throw new Refused(HttpStatus.CONFLICT, "The student has not given their name as on their certificate yet.");
        }
        EndorsementKind kind = EndorsementKind.of(request.code())
                .orElseThrow(() -> new Refused(HttpStatus.BAD_REQUEST, "No such endorsement: " + request.code() + "."));
        Map<String, String> fields = kind.fieldsFrom(request.fields());
        List<String> missing = kind.missing(fields);
        if (!missing.isEmpty()) {
            throw new Refused(HttpStatus.BAD_REQUEST, "Fill in " + String.join(", ", missing).toLowerCase(Locale.ROOT) + ".");
        }
        String text = kind.render(student.getFullName(), fields);
        if (!text.equals(request.text().replaceAll("\\s+", " ").strip())) {
            throw new Refused(HttpStatus.CONFLICT, "The words have changed since you read them: read them again before signing.");
        }
        CrossCountryReview review = null;
        if (request.reviewId() != null) {
            review = reviews.findById(request.reviewId())
                    .filter(r -> r.getStudent().getId().equals(student.getId()) && r.getInstructor().getId().equals(instructor.getId()))
                    .orElseThrow(() -> new Refused(HttpStatus.NOT_FOUND, "No such review."));
            if (review.isAnswered() || kind != EndorsementKind.SOLO_XC_FLIGHT) {
                throw new Refused(HttpStatus.CONFLICT, "That review has been answered.");
            }
        }
        String signature = signatureLine(instructor, request.signedOn());
        SignedEndorsement endorsement = signed.save(new SignedEndorsement(student, instructor, kind.code, student.getFullName(),
                fields, text, signature, request.signedOn(), now, digest(text, signature, now)));
        if (review != null) {
            review.endorsed(endorsement, now);
        }
        String said = kind.label + " (AC 61-65K " + kind.paragraph + ", 14 CFR " + kind.rule + ")\n\n" + text + "\n\n" + signature;
        send(student.getEmail(), "Endorsed: " + kind.label,
                EndorsementRecords.nameOf(instructor) + " has signed this endorsement for you in Wingtip Maps:\n\n" + said
                        + "\n\nIt is on your Checkride page, under Logbook." + openLine());
        send(instructor.getEmail(), "You signed: " + kind.label + " for " + student.getFullName(),
                "You signed this endorsement in Wingtip Maps, kept with your students' records (14 CFR 61.189):\n\n" + said);
        return endorsement;
    }

    /** A signed endorsement voided by the instructor who signed it, for a
     *  correction (AC 120-78B 2.2.8): it stays, marked void.
     *  @return false where there is no such endorsement of theirs in force */
    @Transactional
    public boolean voidEndorsement(Pilot instructor, Long id, Instant now) {
        return signed.findById(id)
                .filter(e -> e.getInstructor() != null && e.getInstructor().getId().equals(instructor.getId()) && !e.isVoided())
                .map(e -> {
                    e.voidAt(now);
                    if (e.getStudent() != null) {
                        send(e.getStudent().getEmail(), "Voided: " + EndorsementKind.of(e.getCode()).map(k -> k.label).orElse(e.getCode()),
                                EndorsementRecords.nameOf(instructor) + " has voided this endorsement of " + e.getSignedOn()
                                        .format(EndorsementRecords.DAY) + ":\n\n" + e.getText() + "\n\n" + e.getSignature());
                    }
                    return true;
                }).orElse(false);
    }

    /** @return false where there is no such review waiting on them */
    @Transactional
    public boolean decline(Pilot instructor, Long reviewId, String note, Instant now) {
        return reviews.findById(reviewId)
                .filter(r -> r.getInstructor().getId().equals(instructor.getId()) && !r.isAnswered())
                .map(r -> {
                    r.declined(note.strip(), now);
                    send(r.getStudent().getEmail(), "Not endorsed: " + String.join(" ", route(r.getFlight())),
                            EndorsementRecords.nameOf(instructor) + " has not endorsed your solo cross-country, "
                                    + String.join(" ", route(r.getFlight())) + " on " + EndorsementRecords.DAY.format(r.getFlightOn())
                                    + ":\n\n\"" + note.strip() + "\"" + openLine());
                    return true;
                }).orElse(false);
    }

    /** The instructor's page: their certificate, students, asks, reviews
     *  waiting and their record of the last 3 years. */
    @Transactional(readOnly = true)
    public InstructorDto instructor(Pilot pilot, Instant now) {
        List<StudentDto> students = links.findByInstructorIdOrderByAcceptedAt(pilot.getId()).stream().map(this::studentOf).toList();
        List<StudentDto> asking = links.findOpenFor(pilot.getEmail()).stream().map(this::studentOf).toList();
        List<CrossCountryReviewDto> waiting = reviews.findByInstructorIdAndAnsweredAtIsNullOrderByAskedAt(pilot.getId()).stream()
                .map(this::reviewOf).toList();
        Instant since = LocalDate.ofInstant(now, ZoneOffset.UTC).minusYears(RECORD_YEARS).atStartOfDay(ZoneOffset.UTC).toInstant();
        return new InstructorDto(pilot.getFullName(), pilot.getInstructorCertificate(), pilot.getInstructorUntil(),
                pilot.getInstructorUntilKind(), students, asking, waiting,
                signed.findByInstructorIdAndSignedAtAfterOrderBySignedAtDesc(pilot.getId(), since).stream()
                        .map(EndorsementRecords::dto).toList(),
                kinds());
    }

    static List<EndorsementKindDto> kinds() {
        return Arrays.stream(EndorsementKind.values()).map(EndorsementKindDto::of).toList();
    }

    /** A review as its instructor or student reads it, with what the
     *  student's record answers of 61.93(d). */
    CrossCountryReviewDto reviewOf(CrossCountryReview r) {
        Long studentId = r.getStudent().getId();
        return EndorsementRecords.dto(r, EndorsementRecords.checks(r.getFlightOn(),
                recorded.findByKeyPilotIdOrderByKeyCode(studentId), signed.findByStudentIdOrderBySignedAtDesc(studentId)));
    }

    private StudentDto studentOf(InstructorLink l) {
        Pilot student = l.getStudent();
        var experience = TrainingService.experience(logbook.findByPilotIdOrderByFlownOnDescIdDesc(student.getId()),
                LocalDate.now(ZoneOffset.UTC));
        List<Endorsement> paper = recorded.findByKeyPilotIdOrderByKeyCode(student.getId());
        List<SignedEndorsement> theirs = signed.findByStudentIdOrderBySignedAtDesc(student.getId());
        int waiting = l.isAccepted() ? (int) reviews.findByStudentIdAndInstructorIdOrderByAskedAtDesc(student.getId(),
                l.getInstructor().getId()).stream().filter(r -> !r.isAnswered()).count() : 0;
        return new StudentDto(l.getId(), student.getId(), EndorsementRecords.nameOf(student), student.getEmail(), l.getAskedAt(),
                l.isAccepted(), (int) experience.stream().filter(i -> i.met()).count(), experience.size(),
                EndorsementRecords.soloUntil(paper, theirs), waiting);
    }

    /** A link ended, by either: the reviews still waiting between the two
     *  go with it. */
    private void end(InstructorLink l) {
        if (l.isAccepted()) {
            reviews.findByStudentIdAndInstructorIdOrderByAskedAtDesc(l.getStudent().getId(), l.getInstructor().getId()).stream()
                    .filter(r -> !r.isAnswered()).forEach(reviews::delete);
        }
        links.delete(l);
    }

    /** AC 61-65K's: "/s/ [date] J. J. Jones 987654321CFI RE 12-31-2026". */
    static String signatureLine(Pilot instructor, LocalDate signedOn) {
        return "/s/ " + EndorsementRecords.DAY.format(signedOn) + " " + instructor.getFullName() + " "
                + instructor.getInstructorCertificate() + " " + instructor.getInstructorUntilKind().words + " "
                + EndorsementRecords.DAY.format(instructor.getInstructorUntil());
    }

    /** SHA-256 of what was signed: the words, the signature line and the
     *  moment, each on its own line. */
    static String digest(String text, String signature, Instant at) {
        try {
            byte[] sum = MessageDigest.getInstance("SHA-256")
                    .digest((text + "\n" + signature + "\n" + at).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(sum);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** The flight's airports in order: departure, stops, destination. */
    static List<String> route(Flight f) {
        return Stream.concat(Stream.concat(Stream.of(f.getDepartureIdent()), f.getStops().stream()),
                Stream.of(f.getDestinationIdent())).toList();
    }

    private String openLine() {
        return publicBaseUrl.isBlank() ? "" : "\n\n" + publicBaseUrl + "/";
    }

    /** An email of these; one that cannot be sent is logged and the rest
     *  goes on, the app holding everything it says. */
    private void send(String to, String subject, String body) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(to);
        message.setSubject("Wingtip Maps: " + subject);
        message.setText(body);
        try {
            mail.send(message);
        } catch (RuntimeException failed) {
            log.warn("Instructor email to {} not sent: {}", to, failed.toString());
        }
    }
}
