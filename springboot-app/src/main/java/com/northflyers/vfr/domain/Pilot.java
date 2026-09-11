package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * Someone who flies. Identity for everything else in the schema.
 *
 * <p>{@code googleSubject} rather than email is what a sign-in matches
 * on. Google's {@code sub} claim is stable for the life of the account;
 * an email address is not, and matching on one would either lose a pilot
 * their flights when they change it or hand them someone else's when it
 * is reassigned. It is nullable so a record can exist before a first
 * sign-in.
 */
@Entity
@Table(name = "pilots")
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

    public Long getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getGoogleSubject() {
        return googleSubject;
    }

    /** Set on first sign-in for a pilot created before they had signed in. */
    public void linkGoogleSubject(String subject) {
        this.googleSubject = subject;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
