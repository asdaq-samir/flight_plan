package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;

/**
 * Someone who flies. Identity for everything else in the schema.
 *
 * <p>{@code googleSubject}/{@code appleSubject} rather than email are
 * what a sign-in matches on. Each provider's {@code sub} claim is stable
 * for the life of the account; an email address is not, and matching on
 * one would either lose a pilot their flights when they change it or
 * hand them someone else's when it is reassigned. Both are nullable so a
 * record can exist before a first sign-in, or be signed into by only one
 * of the two providers (or neither, for a pilot who only ever uses the
 * magic-link email flow, which matches on email directly and needs no
 * subject column of its own).
 */
@Entity
@Table(name = "pilots")
@Getter
public class Pilot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 320)
    private String email;

    @Column(nullable = false)
    private String displayName;

    @Column(unique = true)
    private String googleSubject;

    @Column(unique = true)
    private String appleSubject;

    /** Defaults to PILOT for every row, including every row that
     *  existed before the column did (V7). A developer is granted, not
     *  inherited. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private PilotRole role = PilotRole.PILOT;

    @Column(nullable = false)
    private Instant createdAt;

    protected Pilot() {
        // JPA
    }

    public Pilot(String email, String displayName, String googleSubject) {
        this.email = email;
        this.displayName = displayName;
        this.googleSubject = googleSubject;
        this.createdAt = Instant.now();
    }

    /** For a pilot's first sign-in via a provider other than Google
     *  (Apple, or the email magic link, which passes {@code null}). */
    public Pilot(String email, String displayName, String googleSubject, String appleSubject) {
        this(email, displayName, googleSubject);
        this.appleSubject = appleSubject;
    }

    /** Set on first Google sign-in for a pilot created before they had
     *  signed in through it. */
    public void linkGoogleSubject(String subject) {
        this.googleSubject = subject;
    }

    /** Set on first Apple sign-in for a pilot created before they had
     *  signed in through it. */
    public void linkAppleSubject(String subject) {
        this.appleSubject = subject;
    }

    /** The address the provider now vouches for, when it changed there. */
    public void changeEmail(String email) {
        this.email = email;
    }
}
