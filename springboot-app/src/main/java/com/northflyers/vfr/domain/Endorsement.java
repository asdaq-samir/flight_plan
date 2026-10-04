package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.LocalDate;
import lombok.Getter;

/**
 * An endorsement the pilot's instructor has given them (an AC 61-65
 * endorsement, by the page's own code for it) and the day it was given:
 * one of each, a new one replacing the old.
 */
@Entity
@Table(name = "pilot_endorsements")
@Getter
public class Endorsement {

    /** The pilot and the endorsement's code. */
    @Embeddable
    public record Key(@Column(name = "pilot_id") Long pilotId, @Column(name = "code", length = 40) String code)
            implements Serializable {
    }

    @EmbeddedId
    private Key key;

    @Column(nullable = false)
    private LocalDate endorsedOn;

    protected Endorsement() {
        // JPA
    }

    public Endorsement(Long pilotId, String code, LocalDate endorsedOn) {
        this.key = new Key(pilotId, code);
        this.endorsedOn = endorsedOn;
    }

    public void endorsedOn(LocalDate day) {
        this.endorsedOn = day;
    }
}
