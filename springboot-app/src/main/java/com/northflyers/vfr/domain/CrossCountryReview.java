package com.northflyers.vfr.domain;

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
import lombok.Getter;

/**
 * A student's saved flight put to their instructor for the review of its
 * planning that 14 CFR 61.93(c)(3) and (d) ask before each solo
 * cross-country (V26): answered by the endorsement signed for it, or
 * turned down with a note.
 */
@Entity
@Table(name = "cross_country_reviews")
@Getter
public class CrossCountryReview {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private Pilot student;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "instructor_id", nullable = false)
    private Pilot instructor;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "flight_id", nullable = false)
    private Flight flight;

    @Column(nullable = false, length = 80)
    private String makeModel;

    @Column(nullable = false)
    private LocalDate flightOn;

    @Column(length = 500)
    private String note;

    @Column(nullable = false)
    private Instant askedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "endorsement_id")
    private SignedEndorsement endorsement;

    @Column(length = 500)
    private String declinedNote;

    private Instant answeredAt;

    protected CrossCountryReview() {
        // JPA
    }

    public CrossCountryReview(Pilot student, Pilot instructor, Flight flight, String makeModel, LocalDate flightOn, String note,
                              Instant askedAt) {
        this.student = student;
        this.instructor = instructor;
        this.flight = flight;
        this.makeModel = makeModel;
        this.flightOn = flightOn;
        this.note = note;
        this.askedAt = askedAt;
    }

    public boolean isAnswered() {
        return answeredAt != null;
    }

    public void endorsed(SignedEndorsement endorsement, Instant at) {
        this.endorsement = endorsement;
        this.answeredAt = at;
    }

    public void declined(String note, Instant at) {
        this.declinedNote = note;
        this.answeredAt = at;
    }
}
