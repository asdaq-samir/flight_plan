package com.northflyers.wingtip;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

import com.northflyers.wingtip.domain.InstructorUntil;
import com.northflyers.wingtip.domain.Pilot;
import com.northflyers.wingtip.dto.ApproachLessonDto;
import com.northflyers.wingtip.dto.AskReviewRequest;
import com.northflyers.wingtip.dto.AssignLessonRequest;
import com.northflyers.wingtip.dto.InstructorRequest;
import com.northflyers.wingtip.dto.LessonProgressRequest;
import com.northflyers.wingtip.dto.QuizAnswerDto;
import com.northflyers.wingtip.dto.SaveFlightRequest;
import com.northflyers.wingtip.dto.TrackDto;
import com.northflyers.wingtip.dto.TrackPointDto;
import com.northflyers.wingtip.repository.PilotRepository;
import com.northflyers.wingtip.service.FlightService;
import com.northflyers.wingtip.service.InstructorService;
import com.northflyers.wingtip.service.LessonService;
import com.northflyers.wingtip.service.Mailer;
import com.northflyers.wingtip.service.TrainingService;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * An approach set as a lesson, against a real Postgres (V30): set by the
 * instructor a student took on, with a note at a fix, the student emailed
 * it; the student's progress kept as they report it, their latest quiz
 * the score their instructor reads; the instructor shown the flights put
 * to them that landed at the field, and only those flights' tracks; no
 * one else's lessons changed; and every lesson gone with the link or
 * either account.
 */
@SpringBootTest
@Testcontainers
class LessonFlowTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    @Autowired
    private PilotRepository pilots;

    @Autowired
    private InstructorService instructors;

    @Autowired
    private LessonService lessons;

    @Autowired
    private TrainingService training;

    @Autowired
    private FlightService flights;

    @Autowired
    private JdbcTemplate jdbc;

    @MockitoBean
    private Mailer mail;

    private static final Instant NOW = Instant.parse("2026-10-31T18:00:00Z");
    private static final LocalDate TODAY = LocalDate.ofInstant(NOW, ZoneOffset.UTC);

    private Pilot newPilot(String name) {
        String unique = UUID.randomUUID().toString();
        return pilots.save(new Pilot(unique + "@example.com", name, "sub-" + unique));
    }

    /** A student and the instructor who took them on. */
    private Pilot[] pair() {
        Pilot student = newPilot("avery");
        Pilot instructor = newPilot("Jo");
        instructors.setFullName(student, "Avery B. Student");
        instructors.setInstructor(instructor, new InstructorRequest("J. J. Jones", "987654321CFI", LocalDate.of(2027, 12, 31),
                InstructorUntil.RE));
        instructors.ask(student, instructor.getEmail(), NOW);
        instructors.accept(instructor, instructors.instructor(instructor, NOW).asking().get(0).linkId(), NOW);
        return new Pilot[] {student, instructor};
    }

    private static AssignLessonRequest ils09() {
        return new AssignLessonRequest("kdlh", "i09", "ILS  RWY 09", "261029",
                Map.of("pykla", "  Power to 1,800 rpm,   gear down ", "DL", "  "), LocalDate.of(2026, 11, 8));
    }

    private ApproachLessonDto theirLesson(Pilot student) {
        return training.training(student, List.of(), TODAY).lessons().get(0);
    }

    @Test
    void aLessonIsSetWithItsNotes_andTheStudentIsEmailedIt() {
        Pilot[] p = pair();
        Pilot student = instructors.student(p[1], p[0].getId()).orElseThrow();
        lessons.assign(p[1], student, ils09(), NOW);

        ApproachLessonDto lesson = theirLesson(p[0]);
        assertThat(lesson.airportIdent()).isEqualTo("KDLH");
        assertThat(lesson.procedureId()).isEqualTo("I09");
        assertThat(lesson.procedureName()).isEqualTo("ILS RWY 09");
        // The blank note left out, the other's spaces made single.
        assertThat(lesson.fixNotes()).containsExactly(Map.entry("PYKLA", "Power to 1,800 rpm, gear down"));
        assertThat(lesson.instructorName()).isEqualTo("J. J. Jones");
        assertThat(lesson.status()).isEqualTo("not-started");
        assertThat(lesson.dueOn()).isEqualTo(LocalDate.of(2026, 11, 8));

        ArgumentCaptor<SimpleMailMessage> sent = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mail, atLeastOnce()).send(sent.capture());
        assertThat(sent.getAllValues()).filteredOn(m -> m.getTo()[0].equals(p[0].getEmail())).last().satisfies(m -> {
            assertThat(m.getSubject()).contains("ILS RWY 09 at KDLH");
            assertThat(m.getText()).contains("by 8 Nov 2026").contains("At PYKLA: \"Power to 1,800 rpm, gear down\"");
        });

        // The same approach again, its quiz not taken: once is enough.
        assertThatThrownBy(() -> lessons.assign(p[1], student, ils09(), NOW))
                .isInstanceOfSatisfying(InstructorService.Refused.class, r -> assertThat(r.status).isEqualTo(HttpStatus.CONFLICT));
        // Their instructor reads it among the student's record.
        assertThat(training.trainingFor(p[1], student, List.of(), TODAY).lessons()).singleElement()
                .satisfies(l -> assertThat(l.id()).isEqualTo(lesson.id()));
    }

    @Test
    void theStudentsProgressIsKept_andTheirLatestQuizIsTheScore() {
        Pilot[] p = pair();
        Pilot student = instructors.student(p[1], p[0].getId()).orElseThrow();
        Long id = lessons.assign(p[1], student, ils09(), NOW).getId();

        assertThat(lessons.progress(p[0], id, new LessonProgressRequest(true, false, null), NOW)).isTrue();
        assertThat(theirLesson(p[0]).status()).isEqualTo("briefed");
        // Briefed again later: the first time stands.
        lessons.progress(p[0], id, new LessonProgressRequest(true, true, null), NOW.plusSeconds(600));
        ApproachLessonDto flown = theirLesson(p[0]);
        assertThat(flown.briefedAt()).isEqualTo(NOW);
        assertThat(flown.flownAt()).isEqualTo(NOW.plusSeconds(600));
        assertThat(flown.status()).isEqualTo("flown");

        QuizAnswerDto right = new QuizAnswerDto("What's the minimum altitude at DL?", "3,300 ft", true);
        QuizAnswerDto wrong = new QuizAnswerDto("What's the final approach fix?", "CFBSJ", false);
        lessons.progress(p[0], id, new LessonProgressRequest(false, false, new LessonProgressRequest.Quiz(List.of(right, wrong), 8)), NOW);
        ApproachLessonDto quizzed = training.trainingFor(p[1], student, List.of(), TODAY).lessons().get(0);
        assertThat(quizzed.status()).isEqualTo("quizzed");
        assertThat(quizzed.quizOf()).isEqualTo(8);
        assertThat(quizzed.quizAnswers()).containsExactly(right, wrong);
        // Asked again: the new attempt replaces the old.
        lessons.progress(p[0], id, new LessonProgressRequest(false, false, new LessonProgressRequest.Quiz(List.of(right), 8)), NOW);
        assertThat(theirLesson(p[0]).quizAnswers()).containsExactly(right);
        // More answers than questions is not a quiz.
        assertThatThrownBy(() -> lessons.progress(p[0], id,
                new LessonProgressRequest(false, false, new LessonProgressRequest.Quiz(List.of(right, wrong), 1)), NOW))
                .isInstanceOf(InstructorService.Refused.class);
    }

    @Test
    void noOneElseChangesOrReadsALesson() {
        Pilot[] p = pair();
        Pilot student = instructors.student(p[1], p[0].getId()).orElseThrow();
        Long id = lessons.assign(p[1], student, ils09(), NOW).getId();
        Pilot stranger = newPilot("Stranger");
        // Another pilot's progress, and another instructor's taking it back.
        assertThat(lessons.progress(p[1], id, new LessonProgressRequest(true, true, null), NOW)).isFalse();
        assertThat(lessons.progress(stranger, id, new LessonProgressRequest(true, true, null), NOW)).isFalse();
        assertThat(lessons.remove(stranger, p[0].getId(), id)).isFalse();
        assertThat(lessons.remove(p[1], stranger.getId(), id)).isFalse();
        assertThat(theirLesson(p[0]).status()).isEqualTo("not-started");
        // Not theirs to read: a stranger's view of the student shows none of it.
        assertThat(lessons.lessonsOf(student, stranger)).isEmpty();
        assertThat(lessons.remove(p[1], p[0].getId(), id)).isTrue();
        assertThat(training.training(p[0], List.of(), TODAY).lessons()).isEmpty();
    }

    @Test
    void theInstructorIsShownTheFlightsPutToThemAtTheField_andOnlyTheirTracks() {
        Pilot[] p = pair();
        Pilot student = instructors.student(p[1], p[0].getId()).orElseThrow();
        lessons.assign(p[1], student, ils09(), NOW);
        Long link = training.training(p[0], List.of(), TODAY).instructors().get(0).id();
        TrackDto track = new TrackDto("practice.gpx", List.of(new TrackPointDto(0, 46.84, -92.36, 3300.0),
                new TrackPointDto(60_000, 46.842, -92.21, 1500.0)));
        // To Duluth by its FAA identifier, with a track, put to them.
        Long duluth = flights.save(p[0], new SaveFlightRequest(null, "KUGN", "DLH", 4500, 300.0, 150.0, 20.0, null,
                List.of(), null, null, null, null)).getId();
        flights.saveTrack(p[0], duluth, track);
        instructors.askReview(p[0], new AskReviewRequest(duluth, link, "Cessna 172", TODAY, null), NOW);
        // Elsewhere, with a track, put to them; and to Duluth with a track, never put to them.
        Long elsewhere = flights.save(p[0], new SaveFlightRequest(null, "KUGN", "KRFD", null, null, null, null, null,
                List.of(), null, null, null, null)).getId();
        flights.saveTrack(p[0], elsewhere, track);
        instructors.askReview(p[0], new AskReviewRequest(elsewhere, link, "Cessna 172", TODAY, null), NOW);
        Long kept = flights.save(p[0], new SaveFlightRequest(null, "KUGN", "KDLH", null, null, null, null, null,
                List.of(), null, null, null, null)).getId();
        flights.saveTrack(p[0], kept, track);

        assertThat(lessons.lessonsOf(student, p[1]).get(0).flights()).extracting(f -> f.id()).containsExactly(duluth);
        assertThat(theirLesson(p[0]).flights()).isEmpty();
        assertThat(lessons.reviewedTrack(p[1], p[0].getId(), duluth)).hasValueSatisfying(t -> assertThat(t.points()).hasSize(2));
        assertThat(lessons.reviewedTrack(p[1], p[0].getId(), kept)).isEmpty();
        assertThat(lessons.reviewedTrack(newPilot("Stranger"), p[0].getId(), duluth)).isEmpty();
    }

    @Test
    void lessonsGoWithTheLink_andWithEitherAccount() {
        Pilot[] p = pair();
        lessons.assign(p[1], instructors.student(p[1], p[0].getId()).orElseThrow(), ils09(), NOW);
        Long link = training.training(p[0], List.of(), TODAY).instructors().get(0).id();
        assertThat(instructors.drop(p[0], link)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM approach_lessons WHERE student_id = ?", Integer.class, p[0].getId())).isZero();

        Pilot[] q = pair();
        lessons.assign(q[1], instructors.student(q[1], q[0].getId()).orElseThrow(), ils09(), NOW);
        jdbc.update("DELETE FROM pilots WHERE id = ?", q[1].getId());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM approach_lessons WHERE student_id = ?", Integer.class, q[0].getId())).isZero();

        Pilot[] r = pair();
        lessons.assign(r[1], instructors.student(r[1], r[0].getId()).orElseThrow(), ils09(), NOW);
        jdbc.update("DELETE FROM pilots WHERE id = ?", r[0].getId());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM approach_lessons WHERE instructor_id = ?", Integer.class, r[1].getId())).isZero();
    }
}
