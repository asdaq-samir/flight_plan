package com.northflyers.vfr.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One pilot's planned flight, and the nav log they filed for it.
 *
 * <p>The corridor's scored checkpoints are shared -- everyone planning
 * C81 to KDLH gets the same ones from planning-service. A flight is one
 * pilot's use of them, and the numbers that make it theirs: their
 * aircraft's true airspeed and burn, their cruise altitude, the winds
 * aloft at the hour they are going. That is why the nav-log values live
 * on {@link FlightCheckpoint}.
 *
 * <p>The aircraft is optional and cleared rather than cascaded when it
 * goes away. A flight that has been flown is a record: selling the
 * aeroplane must not delete the history of having flown it.
 */
@Entity
@Table(name = "flights")
public class Flight {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "pilot_id", nullable = false)
    private Pilot pilot;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "aircraft_id")
    private Aircraft aircraft;

    @Column(nullable = false, length = 8)
    private String departureIdent;

    @Column(nullable = false, length = 8)
    private String destinationIdent;

    private Integer cruiseAltitudeFt;
    private Double totalDistanceNm;
    private Double totalEteMin;
    private Double totalFuelGal;
    private Instant plannedFor;

    @Column(nullable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "flight", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @OrderBy("sequenceNo ASC")
    private List<FlightCheckpoint> checkpoints = new ArrayList<>();

    protected Flight() {
        // JPA
    }

    public Flight(Pilot pilot, Aircraft aircraft, String departureIdent, String destinationIdent) {
        this.pilot = pilot;
        this.aircraft = aircraft;
        this.departureIdent = departureIdent;
        this.destinationIdent = destinationIdent;
        this.createdAt = Instant.now();
    }

    /** The filed nav log. Replaces any previous one, since re-planning a
     *  flight produces a new log rather than more of the old one. */
    public Flight fileNavLog(List<FlightCheckpoint> navLog, Integer cruiseAltitudeFt,
                             Double totalDistanceNm, Double totalEteMin, Double totalFuelGal) {
        this.checkpoints.clear();
        navLog.forEach(checkpoint -> {
            checkpoint.setFlight(this);
            this.checkpoints.add(checkpoint);
        });
        this.cruiseAltitudeFt = cruiseAltitudeFt;
        this.totalDistanceNm = totalDistanceNm;
        this.totalEteMin = totalEteMin;
        this.totalFuelGal = totalFuelGal;
        return this;
    }

    public Flight plannedFor(Instant when) {
        this.plannedFor = when;
        return this;
    }

    public Long getId() {
        return id;
    }

    public Pilot getPilot() {
        return pilot;
    }

    public Aircraft getAircraft() {
        return aircraft;
    }

    public String getDepartureIdent() {
        return departureIdent;
    }

    public String getDestinationIdent() {
        return destinationIdent;
    }

    public Integer getCruiseAltitudeFt() {
        return cruiseAltitudeFt;
    }

    public Double getTotalDistanceNm() {
        return totalDistanceNm;
    }

    public Double getTotalEteMin() {
        return totalEteMin;
    }

    public Double getTotalFuelGal() {
        return totalFuelGal;
    }

    public Instant getPlannedFor() {
        return plannedFor;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public List<FlightCheckpoint> getCheckpoints() {
        return checkpoints;
    }
}
