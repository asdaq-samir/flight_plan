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
import lombok.Getter;

/** A student's instructor (V26): asked by address, and taken by whoever
 *  signs in with that address -- the instructor, from then on. */
@Entity
@Table(name = "instructor_students")
@Getter
public class InstructorLink {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private Pilot student;

    @Column(nullable = false, length = 320)
    private String email;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "instructor_id")
    private Pilot instructor;

    @Column(nullable = false)
    private Instant askedAt;

    private Instant acceptedAt;

    protected InstructorLink() {
        // JPA
    }

    public InstructorLink(Pilot student, String email, Instant askedAt) {
        this.student = student;
        this.email = email;
        this.askedAt = askedAt;
    }

    public void accept(Pilot instructor, Instant at) {
        this.instructor = instructor;
        this.acceptedAt = at;
    }

    public boolean isAccepted() {
        return instructor != null;
    }
}
