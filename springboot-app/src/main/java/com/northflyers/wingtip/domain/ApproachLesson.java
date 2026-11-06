package com.northflyers.wingtip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An instrument approach an instructor set one of their students to
 * learn in the app's approach lesson (V30): the approach as the planner's
 * procedures name it, the instructor's note at any of its fixes and the
 * day to have it done by; and the student's progress with it, as their
 * app reports it -- briefed, flown, and their latest quiz.
 */
@Entity
@Table(name = "approach_lessons")
@Getter
public class ApproachLesson {

    /** One quiz question answered: the question as asked, the choice
     *  made, and whether it was the right one. */
    public record Answer(String question, String chosen, boolean right) {
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private Pilot student;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "instructor_id", nullable = false)
    private Pilot instructor;

    @Column(nullable = false, length = 5)
    private String airportIdent;

    @Column(nullable = false, length = 6)
    private String procedureId;

    @Column(nullable = false, length = 80)
    private String procedureName;

    @Column(length = 8)
    private String cycle;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, String> fixNotes;

    private LocalDate dueOn;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    private Instant briefedAt;

    private Instant flownAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<Answer> quizAnswers;

    private Integer quizOf;

    private Instant quizAt;

    protected ApproachLesson() {
        // JPA
    }

    public ApproachLesson(Pilot student, Pilot instructor, String airportIdent, String procedureId, String procedureName, String cycle,
                          Map<String, String> fixNotes, LocalDate dueOn, Instant now) {
        this.student = student;
        this.instructor = instructor;
        this.airportIdent = airportIdent;
        this.procedureId = procedureId;
        this.procedureName = procedureName;
        this.cycle = cycle;
        this.fixNotes = fixNotes;
        this.dueOn = dueOn;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** The first time the brief was finished; later ones change nothing. */
    public void briefed(Instant at) {
        if (briefedAt == null) {
            briefedAt = at;
            updatedAt = at;
        }
    }

    /** The first time it was flown to its end; later ones change nothing. */
    public void flown(Instant at) {
        if (flownAt == null) {
            flownAt = at;
            updatedAt = at;
        }
    }

    /** The quiz as far as it has been answered, the latest attempt's
     *  answers replacing the one before. */
    public void quizzed(List<Answer> answers, int of, Instant at) {
        quizAnswers = List.copyOf(answers);
        quizOf = of;
        quizAt = at;
        updatedAt = at;
    }
}
