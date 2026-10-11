package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;

/**
 * A pilot's subscription to the paid features ({@link PaidFeature}): the
 * free month, once an account, and what they paid for. One row a pilot,
 * keyed by them, made the first time either is recorded (V19).
 */
@Entity
@Table(name = "subscriptions")
@Getter
public class Subscription {

    public enum Plan { MONTHLY, YEARLY }

    /** Where it was bought: Apple's or Google's store, the website, or
     *  given (an instructor's, a tester's). */
    public enum Store { APP_STORE, PLAY, WEB, GRANT }

    @Id
    private Long pilotId;

    private Instant trialStartedAt;
    private Instant trialEndsAt;

    private Instant paidUntil;

    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private Plan plan;

    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private Store store;

    /** The store's own id for it -- Apple's original transaction id,
     *  Google's purchase token, Stripe's subscription -- which its
     *  server's notifications name. */
    @Column(length = 200)
    private String storeRef;

    @Column(nullable = false)
    private Instant updatedAt;

    protected Subscription() {
        // JPA
    }

    public Subscription(Long pilotId, Instant now) {
        this.pilotId = pilotId;
        this.updatedAt = now;
    }

    /** The free month, from now. Once an account: the caller checks. */
    public void startTrial(Instant now, Instant ends) {
        this.trialStartedAt = now;
        this.trialEndsAt = ends;
        this.updatedAt = now;
    }

    /** Paid for until {@code until}, as a store's notification or a
     *  grant says. */
    public void paid(Instant until, Plan plan, Store store, String storeRef, Instant now) {
        this.paidUntil = until;
        this.plan = plan;
        this.store = store;
        this.storeRef = storeRef;
        this.updatedAt = now;
    }
}
