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

/**
 * One line of a filed nav log.
 *
 * <p>The leg fields describe the leg <em>leaving</em> this fix, which is
 * how a nav log is read in the cockpit: you are over the checkpoint, and
 * these are the numbers to the next one. They are all null on the last
 * row, which is the destination and has no leg after it.
 *
 * <p>Groundspeed, ETE and fuel are separately nullable, and that is a
 * real case rather than defensiveness: a leg whose wind component exceeds
 * true airspeed cannot be flown, and has no answer for any of the three.
 * Storing zero there would read as a fast leg costing no fuel.
 */
@Entity
@Table(name = "flight_checkpoints")
public class FlightCheckpoint {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "flight_id", nullable = false)
    private Flight flight;

    /** Not `sequence`, which is reserved in SQL. */
    @Column(name = "sequence_no", nullable = false)
    private int sequenceNo;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, length = 64)
    private String category;

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lon;

    @Column(nullable = false)
    private double alongTrackNm;

    private Double legDistanceNm;
    private Double trueCourseDeg;
    private Double magneticHeadingDeg;
    private Double groundspeedKt;
    private Double eteMin;
    private Double fuelGal;

    protected FlightCheckpoint() {
        // JPA
    }

    public FlightCheckpoint(int sequenceNo, String name, String category,
                            double lat, double lon, double alongTrackNm) {
        this.sequenceNo = sequenceNo;
        this.name = name;
        this.category = category;
        this.lat = lat;
        this.lon = lon;
        this.alongTrackNm = alongTrackNm;
    }

    /** The leg leaving this fix. Left unset on the destination row. */
    public FlightCheckpoint withLeg(Double legDistanceNm, Double trueCourseDeg, Double magneticHeadingDeg,
                                    Double groundspeedKt, Double eteMin, Double fuelGal) {
        this.legDistanceNm = legDistanceNm;
        this.trueCourseDeg = trueCourseDeg;
        this.magneticHeadingDeg = magneticHeadingDeg;
        this.groundspeedKt = groundspeedKt;
        this.eteMin = eteMin;
        this.fuelGal = fuelGal;
        return this;
    }

    void setFlight(Flight flight) {
        this.flight = flight;
    }

    public Long getId() {
        return id;
    }

    public Flight getFlight() {
        return flight;
    }

    public int getSequenceNo() {
        return sequenceNo;
    }

    public String getName() {
        return name;
    }

    public String getCategory() {
        return category;
    }

    public double getLat() {
        return lat;
    }

    public double getLon() {
        return lon;
    }

    public double getAlongTrackNm() {
        return alongTrackNm;
    }

    public Double getLegDistanceNm() {
        return legDistanceNm;
    }

    public Double getTrueCourseDeg() {
        return trueCourseDeg;
    }

    public Double getMagneticHeadingDeg() {
        return magneticHeadingDeg;
    }

    public Double getGroundspeedKt() {
        return groundspeedKt;
    }

    public Double getEteMin() {
        return eteMin;
    }

    public Double getFuelGal() {
        return fuelGal;
    }
}
