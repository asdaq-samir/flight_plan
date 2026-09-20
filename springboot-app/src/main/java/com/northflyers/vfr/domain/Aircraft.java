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
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

/**
 * One aeroplane, belonging to one pilot.
 *
 * <p>True airspeed and fuel burn are held per aircraft rather than per
 * type because that is what they are: properties of the individual
 * machine and of how its owner flies it. A tired C172 does not make book
 * numbers, and the dead-reckoning math consumes these two values
 * directly, so a wrong one is a wrong nav log rather than a wrong label.
 *
 * <p>Usable fuel is the third such number: what the tanks actually hold
 * for the trip and the reserve, which the nav log checks the total
 * against. Nullable, since an aeroplane added before it was asked for
 * -- or one whose owner has not said -- should get no fuel check rather
 * than a wrong one.
 */
@Entity
@Table(name = "aircraft", uniqueConstraints =
        @UniqueConstraint(name = "uq_aircraft_pilot_tail", columnNames = {"pilot_id", "tail_number"}))
public class Aircraft {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "pilot_id", nullable = false)
    private Pilot pilot;

    @Column(name = "tail_number", nullable = false, length = 16)
    private String tailNumber;

    /** ICAO type designator: C172, PA28, BE36. */
    @Column(nullable = false, length = 16)
    private String typeDesignator;

    @Column(nullable = false)
    private double cruiseTasKt;

    @Column(nullable = false)
    private double fuelBurnGph;

    private Double usableFuelGal;

    @Column(nullable = false)
    private Instant createdAt;

    protected Aircraft() {
        // JPA
    }

    public Aircraft(Pilot pilot, String tailNumber, String typeDesignator,
                    double cruiseTasKt, double fuelBurnGph, Double usableFuelGal) {
        this.pilot = pilot;
        this.tailNumber = tailNumber;
        this.typeDesignator = typeDesignator;
        this.cruiseTasKt = cruiseTasKt;
        this.fuelBurnGph = fuelBurnGph;
        this.usableFuelGal = usableFuelGal;
        this.createdAt = Instant.now();
    }

    /** Replaces every editable field at once -- an aeroplane's own
     *  numbers change together (a new owner, a re-rigged engine) often
     *  enough that a partial update isn't worth the extra API shape. */
    public Aircraft update(String tailNumber, String typeDesignator, double cruiseTasKt, double fuelBurnGph,
                           Double usableFuelGal) {
        this.tailNumber = tailNumber;
        this.typeDesignator = typeDesignator;
        this.cruiseTasKt = cruiseTasKt;
        this.fuelBurnGph = fuelBurnGph;
        this.usableFuelGal = usableFuelGal;
        return this;
    }

    public Long getId() {
        return id;
    }

    public Pilot getPilot() {
        return pilot;
    }

    public String getTailNumber() {
        return tailNumber;
    }

    public String getTypeDesignator() {
        return typeDesignator;
    }

    public double getCruiseTasKt() {
        return cruiseTasKt;
    }

    public double getFuelBurnGph() {
        return fuelBurnGph;
    }

    public Double getUsableFuelGal() {
        return usableFuelGal;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
