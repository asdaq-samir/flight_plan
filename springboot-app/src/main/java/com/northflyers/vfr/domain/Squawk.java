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
import java.time.LocalDate;
import lombok.Getter;

/** A squawk on an airplane (V24): what was found, whether it is
 *  inoperative equipment and the kinds of flight its 91.213(d)
 *  determination covers, and its fix. Open until fixed. */
@Entity
@Table(name = "aircraft_squawks")
@Getter
public class Squawk {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "aircraft_id", nullable = false)
    private Aircraft aircraft;

    @Column(nullable = false)
    private LocalDate reportedOn;

    @Column(nullable = false, length = 500)
    private String text;

    @Column(nullable = false)
    private boolean inoperative;

    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private DeferredFor deferredFor;

    private LocalDate fixedOn;

    @Column(length = 500)
    private String fixNote;

    protected Squawk() {
        // JPA
    }

    public Squawk(Aircraft aircraft) {
        this.aircraft = aircraft;
    }

    /** Every field at once, as its form sends them. A determination is
     *  only an inoperative item's. */
    public Squawk set(LocalDate reportedOn, String text, boolean inoperative, DeferredFor deferredFor, LocalDate fixedOn,
                      String fixNote) {
        this.reportedOn = reportedOn;
        this.text = text;
        this.inoperative = inoperative;
        this.deferredFor = inoperative ? deferredFor : null;
        this.fixedOn = fixedOn;
        this.fixNote = fixNote;
        return this;
    }
}
