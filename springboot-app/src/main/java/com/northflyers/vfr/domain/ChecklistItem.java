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
import lombok.Getter;

/** One line of an airplane's checklist, as its owner writes it from the
 *  airplane's flight manual: its section, the challenge and the response
 *  ("Fuel selector -- Both"), in order (V22). */
@Entity
@Table(name = "aircraft_checklist_items")
@Getter
public class ChecklistItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "aircraft_id", nullable = false)
    private Aircraft aircraft;

    /** Not `sequence`, which is reserved in SQL. */
    @Column(name = "sequence_no", nullable = false)
    private int sequenceNo;

    @Column(nullable = false, length = 40)
    private String section;

    @Column(nullable = false, length = 80)
    private String challenge;

    @Column(length = 80)
    private String response;

    protected ChecklistItem() {
        // JPA
    }

    public ChecklistItem(Aircraft aircraft, int sequenceNo, String section, String challenge, String response) {
        this.aircraft = aircraft;
        this.sequenceNo = sequenceNo;
        this.section = section;
        this.challenge = challenge;
        this.response = response;
    }
}
