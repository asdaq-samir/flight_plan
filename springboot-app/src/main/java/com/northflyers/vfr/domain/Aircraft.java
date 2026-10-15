package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.time.LocalDate;
import lombok.Getter;

/**
 * One aeroplane, belonging to one pilot.
 *
 * <p>True airspeed and fuel burn are held per aircraft rather than per
 * type because that is what they are: properties of the individual
 * machine and of how its owner flies it. A tired C172 does not make book
 * numbers, and the dead-reckoning math consumes these two values
 * directly, so a wrong one is a wrong nav log rather than a wrong label.
 *
 * <p>With them, the power they are at, in percent: the planner takes the
 * two as the aeroplane's at that power at 6,000 ft on a standard day and
 * flies each leg at what they come to in its own air (the density
 * altitude the forecast temperature gives). Nullable: an aeroplane added
 * before it was asked for, or whose owner has not said, is flown at its
 * type's.
 *
 * <p>The climb has its own two: the speed it is flown at and what it
 * burns, which is more than the cruise. Nullable: an aeroplane added
 * before they were asked for, or whose owner has not said, climbs at
 * the planner's book figures for its type.
 *
 * <p>Usable fuel is the last such number: what the tanks actually hold
 * for the trip and the reserve, which the nav log checks the total
 * against. Nullable, since an aeroplane added before it was asked for
 * -- or one whose owner has not said -- should get no fuel check rather
 * than a wrong one.
 */
@Entity
@Table(name = "aircraft", uniqueConstraints =
        @UniqueConstraint(name = "uq_aircraft_pilot_tail", columnNames = {"pilot_id", "tail_number"}))
@Getter
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

    private Double cruisePowerPct;

    private Double climbTasKt;

    private Double climbFuelBurnGph;

    private Double usableFuelGal;

    @Column(nullable = false)
    private Instant createdAt;

    /** Its last VOR check for IFR (14 CFR 91.171, V20): when, how, where
     *  and the bearing error found; null until one is recorded. */
    private LocalDate vorCheckOn;
    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private VorCheck vorCheckKind;
    @Column(length = 80)
    private String vorCheckPlace;
    private Double vorCheckErrorDeg;

    /** Its inspections and tests, as its owner records them from its
     *  maintenance records (V21): the annual (14 CFR 91.409(a)), the time in
     *  service at the last annual or 100-hour and now (91.409(b)), the
     *  altimeter and static test (91.411), the transponder test (91.413),
     *  the ELT's inspection (91.207(d)) and the date its battery is to be
     *  replaced by (91.207(c)). Each null until recorded. */
    private LocalDate annualOn;
    private Double hundredHourAtHours;
    private Double hoursNow;
    private LocalDate staticCheckOn;
    private LocalDate transponderCheckOn;
    private LocalDate eltInspectedOn;
    private LocalDate eltBatteryDueOn;

    protected Aircraft() {
        // JPA
    }

    public Aircraft(Pilot pilot, String tailNumber, String typeDesignator, double cruiseTasKt, double fuelBurnGph,
                    Double cruisePowerPct, Double climbTasKt, Double climbFuelBurnGph, Double usableFuelGal) {
        this.pilot = pilot;
        this.tailNumber = tailNumber;
        this.typeDesignator = typeDesignator;
        this.cruiseTasKt = cruiseTasKt;
        this.fuelBurnGph = fuelBurnGph;
        this.cruisePowerPct = cruisePowerPct;
        this.climbTasKt = climbTasKt;
        this.climbFuelBurnGph = climbFuelBurnGph;
        this.usableFuelGal = usableFuelGal;
        this.createdAt = Instant.now();
    }

    /** Replaces every editable field at once -- an aeroplane's own
     *  numbers change together (a new owner, a re-rigged engine) often
     *  enough that a partial update isn't worth the extra API shape. */
    public Aircraft update(String tailNumber, String typeDesignator, double cruiseTasKt, double fuelBurnGph,
                           Double cruisePowerPct, Double climbTasKt, Double climbFuelBurnGph, Double usableFuelGal) {
        this.tailNumber = tailNumber;
        this.typeDesignator = typeDesignator;
        this.cruiseTasKt = cruiseTasKt;
        this.fuelBurnGph = fuelBurnGph;
        this.cruisePowerPct = cruisePowerPct;
        this.climbTasKt = climbTasKt;
        this.climbFuelBurnGph = climbFuelBurnGph;
        this.usableFuelGal = usableFuelGal;
        return this;
    }

    /** Its inspections and tests, all at once, as the form has them. */
    public Aircraft recordInspections(LocalDate annualOn, Double hundredHourAtHours, Double hoursNow, LocalDate staticCheckOn,
                                      LocalDate transponderCheckOn, LocalDate eltInspectedOn, LocalDate eltBatteryDueOn) {
        this.annualOn = annualOn;
        this.hundredHourAtHours = hundredHourAtHours;
        this.hoursNow = hoursNow;
        this.staticCheckOn = staticCheckOn;
        this.transponderCheckOn = transponderCheckOn;
        this.eltInspectedOn = eltInspectedOn;
        this.eltBatteryDueOn = eltBatteryDueOn;
        return this;
    }

    /** A VOR check, as the pilot records it (91.171(d)). */
    public Aircraft recordVorCheck(LocalDate on, VorCheck kind, String place, double errorDeg) {
        this.vorCheckOn = on;
        this.vorCheckKind = kind;
        this.vorCheckPlace = place;
        this.vorCheckErrorDeg = errorDeg;
        return this;
    }
}
