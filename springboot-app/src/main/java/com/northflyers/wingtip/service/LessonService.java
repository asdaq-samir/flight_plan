package com.northflyers.wingtip.service;

import com.northflyers.wingtip.domain.ApproachLesson;
import com.northflyers.wingtip.domain.CrossCountryReview;
import com.northflyers.wingtip.domain.Flight;
import com.northflyers.wingtip.domain.Pilot;
import com.northflyers.wingtip.dto.ApproachLessonDto;
import com.northflyers.wingtip.dto.AssignLessonRequest;
import com.northflyers.wingtip.dto.FlightSummaryDto;
import com.northflyers.wingtip.dto.LessonProgressRequest;
import com.northflyers.wingtip.dto.QuizAnswerDto;
import com.northflyers.wingtip.dto.TrackDto;
import com.northflyers.wingtip.repository.ApproachLessonRepository;
import com.northflyers.wingtip.repository.CrossCountryReviewRepository;
import com.northflyers.wingtip.repository.InstructorLinkRepository;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Approaches an instructor sets their students to learn in the app's
 * approach lesson (Brief, Fly, Quiz), at the owner's "do it all"
 * (2026-10-30): the instructor picks a field's approach from the
 * planner's procedures, leaves a note at any of its fixes and a day to
 * have it done by, and the student is emailed; the student's app reports
 * as the lesson goes -- the brief finished, the approach flown to its
 * end, each quiz answer -- and the instructor reads it back, with the
 * student's flights put to them (a solo cross-country's review) that
 * landed at the field, whose tracks their app debriefs against it.
 *
 * <p>The instructor's side is only for a student who took them on
 * (InstructorLink), as every instructor feature is; the student's only
 * for their own lessons. Anything else is "no such lesson", never a
 * refusal that says one exists. A lesson goes with either account and
 * with the link when either ends it: it is teaching, not a record 14 CFR
 * 61.189 asks the instructor to keep, as a signed endorsement is.
 */
@Service
public class LessonService {

    private static final DateTimeFormatter SAID = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US);

    private final ApproachLessonRepository lessons;
    private final InstructorLinkRepository links;
    private final CrossCountryReviewRepository reviews;
    private final FlightService flights;
    private final InstructorService instructors;

    public LessonService(ApproachLessonRepository lessons, InstructorLinkRepository links, CrossCountryReviewRepository reviews,
                         FlightService flights, InstructorService instructors) {
        this.lessons = lessons;
        this.links = links;
        this.reviews = reviews;
        this.flights = flights;
        this.instructors = instructors;
    }

    // ---- The instructor's side

    /** An approach set as a lesson for one of the instructor's students,
     *  who is emailed. 409 where the same approach is set them already and
     *  its quiz not yet taken. */
    @Transactional
    public ApproachLesson assign(Pilot instructor, Pilot student, AssignLessonRequest request, Instant now) {
        String field = request.airportIdent().strip().toUpperCase(Locale.ROOT);
        String procedure = request.procedureId().strip().toUpperCase(Locale.ROOT);
        boolean open = lessons.findByStudentIdAndInstructorIdOrderByCreatedAtDesc(student.getId(), instructor.getId()).stream()
                .anyMatch(l -> l.getAirportIdent().equals(field) && l.getProcedureId().equals(procedure) && l.getQuizAt() == null);
        if (open) {
            throw new InstructorService.Refused(HttpStatus.CONFLICT, "You have set them this approach already.");
        }
        String name = request.procedureName().strip().replaceAll("\\s+", " ");
        ApproachLesson lesson = lessons.save(new ApproachLesson(student, instructor, field, procedure, name,
                Typed.text(request.cycle()), notesOf(request.fixNotes()), request.dueOn(), now));
        String by = EndorsementRecords.nameOf(instructor);
        StringBuilder body = new StringBuilder(by + " has set you an approach to learn in Wingtip Maps: the " + name + " at " + field
                + (request.dueOn() == null ? "" : ", by " + SAID.format(request.dueOn())) + ".\n");
        lesson.getFixNotes().forEach((fix, note) -> body.append("\nAt ").append(fix).append(": \"").append(note).append('"'));
        body.append("\n\nOpen Logbook, then Checkride, to brief it, fly it and take its quiz.").append(instructors.openLine());
        instructors.send(student.getEmail(), by + " set you the " + name + " at " + field, body.toString());
        return lesson;
    }

    /** @return false where there is no such lesson of theirs for the student */
    @Transactional
    public boolean remove(Pilot instructor, Long studentId, Long lessonId) {
        return lessons.findById(lessonId).filter(l -> isBetween(l, studentId, instructor.getId())).map(l -> {
            lessons.delete(l);
            return true;
        }).orElse(false);
    }

    /** The track of a flight the student put to this instructor, for its
     *  approach to be debriefed in their app; empty where the student is
     *  not theirs, the flight was never put to them, or it has no track. */
    @Transactional(readOnly = true)
    public Optional<TrackDto> reviewedTrack(Pilot instructor, Long studentId, Long flightId) {
        if (links.findByStudentIdAndInstructorId(studentId, instructor.getId()).isEmpty()) {
            return Optional.empty();
        }
        boolean putToThem = reviews.findByStudentIdAndInstructorIdOrderByAskedAtDesc(studentId, instructor.getId()).stream()
                .anyMatch(r -> r.getFlight().getId().equals(flightId));
        return putToThem ? flights.trackOf(flightId) : Optional.empty();
    }

    // ---- The student's side

    /** The lesson's progress, as the student's app reports it.
     *  @return false where there is no such lesson of theirs */
    @Transactional
    public boolean progress(Pilot student, Long lessonId, LessonProgressRequest request, Instant now) {
        return lessons.findById(lessonId).filter(l -> l.getStudent().getId().equals(student.getId())).map(l -> {
            if (request.briefed()) {
                l.briefed(now);
            }
            if (request.flown()) {
                l.flown(now);
            }
            LessonProgressRequest.Quiz quiz = request.quiz();
            if (quiz != null) {
                if (quiz.answers().size() > quiz.of()) {
                    throw new InstructorService.Refused(HttpStatus.BAD_REQUEST, "More answers than questions.");
                }
                l.quizzed(quiz.answers().stream().map(a -> new ApproachLesson.Answer(a.question().strip(), a.chosen().strip(), a.right()))
                        .toList(), quiz.of(), now);
            }
            return true;
        }).orElse(false);
    }

    // ---- Both

    /** A student's lessons, newest first: all of them for the student, or
     *  for an instructor only those they set, with the flights put to them
     *  that landed at each lesson's field and have a track. */
    @Transactional(readOnly = true)
    public List<ApproachLessonDto> lessonsOf(Pilot student, @Nullable Pilot instructor) {
        if (instructor == null) {
            return lessons.findByStudentIdOrderByCreatedAtDesc(student.getId()).stream().map(l -> dto(l, List.of())).toList();
        }
        List<Flight> reviewed = reviews.findByStudentIdAndInstructorIdOrderByAskedAtDesc(student.getId(), instructor.getId()).stream()
                .map(CrossCountryReview::getFlight).distinct().filter(f -> flights.hasTrack(f.getId())).toList();
        return lessons.findByStudentIdAndInstructorIdOrderByCreatedAtDesc(student.getId(), instructor.getId()).stream()
                .map(l -> dto(l, reviewed.stream().filter(f -> landsAt(f, l.getAirportIdent())).map(FlightSummaryDto::of).toList()))
                .toList();
    }

    /** How far along: the quiz taken past the flying past the brief. */
    static String status(ApproachLesson l) {
        if (l.getQuizAt() != null) {
            return "quizzed";
        }
        if (l.getFlownAt() != null) {
            return "flown";
        }
        return l.getBriefedAt() != null ? "briefed" : "not-started";
    }

    /** The notes as given: each fix's identifier in capitals, its words
     *  with their spaces made single, the blank ones left out. */
    static Map<String, String> notesOf(Map<String, String> typed) {
        Map<String, String> notes = new LinkedHashMap<>();
        typed.forEach((fix, note) -> {
            String words = Typed.words(note);
            if (words != null) {
                notes.put(fix.strip().toUpperCase(Locale.ROOT), words);
            }
        });
        return notes;
    }

    /** Whether a flight landed at the field, at a stop or its end: the
     *  procedures' ICAO identifier ("KBUR") and a flight's FAA one ("BUR")
     *  the same field. */
    static boolean landsAt(Flight f, String ident) {
        return Stream.concat(f.getStops().stream(), Stream.of(f.getDestinationIdent())).anyMatch(at -> sameField(at, ident));
    }

    static boolean sameField(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        String x = a.strip().toUpperCase(Locale.ROOT), y = b.strip().toUpperCase(Locale.ROOT);
        return x.equals(y) || (x.length() == 3 && y.equals("K" + x)) || (y.length() == 3 && x.equals("K" + y));
    }

    private static boolean isBetween(ApproachLesson l, Long studentId, Long instructorId) {
        return l.getStudent().getId().equals(studentId) && l.getInstructor().getId().equals(instructorId);
    }

    private static ApproachLessonDto dto(ApproachLesson l, List<FlightSummaryDto> flown) {
        List<QuizAnswerDto> answers = l.getQuizAnswers() == null ? List.of()
                : l.getQuizAnswers().stream().map(a -> new QuizAnswerDto(a.question(), a.chosen(), a.right())).toList();
        return new ApproachLessonDto(l.getId(), l.getStudent().getId(), EndorsementRecords.nameOf(l.getStudent()),
                EndorsementRecords.nameOf(l.getInstructor()), l.getAirportIdent(), l.getProcedureId(), l.getProcedureName(), l.getCycle(),
                l.getFixNotes(), l.getDueOn(), l.getCreatedAt(), l.getUpdatedAt(), status(l), l.getBriefedAt(), l.getFlownAt(), answers,
                l.getQuizOf(), l.getQuizAt(), flown);
    }
}
