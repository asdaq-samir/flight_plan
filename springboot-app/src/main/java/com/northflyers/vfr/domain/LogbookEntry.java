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
 * A flight in the pilot's logbook, in a paper logbook's columns: the day,
 * the aeroplane, the route, the hours and the landings. The landings are
 * full-stop ones, by day and at night -- what 14 CFR 61.57 counts for
 * carrying passengers (see {@code CurrencyService}).
 *
 * <p>The aeroplane is text, not a reference to {@link Aircraft}: an
 * entry is a record and outlives the aeroplane's.
 */
@Entity
@Table(name = "logbook_entries")
@Getter
public class LogbookEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "pilot_id", nullable = false)
    private Pilot pilot;

    @Column(nullable = false)
    private LocalDate flownOn;

    @Column(length = 16)
    private String aircraft;

    @Column(length = 16)
    private String aircraftType;

    @Column(length = 120)
    private String route;

    private double totalHours;
    private double nightHours;
    private double crossCountryHours;
    private int dayLandings;
    private int nightLandings;

    @Column(length = 500)
    private String remarks;

    @Column(nullable = false)
    private Instant createdAt;

    protected LogbookEntry() {
        // JPA
    }

    public LogbookEntry(Pilot pilot) {
        this.pilot = pilot;
        this.createdAt = Instant.now();
    }

    /** Every column at once, as the entry's form sends them. */
    public LogbookEntry set(LocalDate flownOn, String aircraft, String aircraftType, String route, double totalHours,
                            double nightHours, double crossCountryHours, int dayLandings, int nightLandings, String remarks) {
        this.flownOn = flownOn;
        this.aircraft = aircraft;
        this.aircraftType = aircraftType;
        this.route = route;
        this.totalHours = totalHours;
        this.nightHours = nightHours;
        this.crossCountryHours = crossCountryHours;
        this.dayLandings = dayLandings;
        this.nightLandings = nightLandings;
        this.remarks = remarks;
        return this;
    }
}
