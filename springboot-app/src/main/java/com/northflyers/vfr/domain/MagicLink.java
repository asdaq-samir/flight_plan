package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A single-use, time-limited bearer token proving one email address
 * asked to sign in. {@code tokenHash} is a SHA-256 of the token actually
 * emailed -- the row itself is a bearer credential for the address it
 * names, the same reason a password column holds a hash rather than the
 * password, so nothing that can sign someone in ever sits in the
 * database (or a backup, or a slow query log) in cleartext.
 *
 * <p>Not linked to a {@link Pilot} row: the pilot may not exist yet
 * (this is how a brand-new pilot signs up, not only how an existing one
 * signs back in), and email is already that entity's own stable
 * identity column once one is created or found.
 */
@Entity
@Table(name = "magic_links")
public class MagicLink {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 320)
    private String email;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant expiresAt;

    @Column
    private Instant consumedAt;

    protected MagicLink() {
        // JPA
    }

    public MagicLink(String email, String tokenHash, Instant expiresAt) {
        this.email = email;
        this.tokenHash = tokenHash;
        this.createdAt = Instant.now();
        this.expiresAt = expiresAt;
    }

    public Long getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getConsumedAt() {
        return consumedAt;
    }
}
