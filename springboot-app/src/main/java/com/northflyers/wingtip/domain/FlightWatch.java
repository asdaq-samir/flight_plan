package com.northflyers.wingtip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;

/**
 * A saved flight the pilot asked to be watched up to departure (V31):
 * the last briefing kept to diff the next against, when it was last
 * checked, and the planner's last answer that said something changed,
 * for the app to show. One a flight, keyed by it, as {@link FlightTrack}
 * is; the pilot's id is kept beside so whose it is costs no join.
 *
 * <p>The briefing and the changes are the planner's JSON, kept as text:
 * nothing aviation is read or worked out here, the gateway only carries
 * what the planner said.
 */
@Entity
@Table(name = "flight_watch")
@Getter
public class FlightWatch {

    @Id
    private Long flightId;

    @Column(nullable = false)
    private Long pilotId;

    @Column(nullable = false)
    private Instant departAt;

    @Column(nullable = false, columnDefinition = "text")
    private String briefingJson;

    private Instant checkedAt;

    private Instant changedAt;

    @Column(columnDefinition = "text")
    private String changesJson;

    @Column(nullable = false)
    private Instant createdAt;

    protected FlightWatch() {
        // JPA
    }

    public FlightWatch(Long flightId, Long pilotId, Instant departAt, String briefingJson, Instant now) {
        this.flightId = flightId;
        this.pilotId = pilotId;
        this.createdAt = now;
        rewatch(departAt, briefingJson);
    }

    /** Watched again, from now: a new departure time and a new baseline.
     *  What changed before is cleared, since "what changed since" starts
     *  over at this briefing. */
    public FlightWatch rewatch(Instant departAt, String briefingJson) {
        this.departAt = departAt;
        this.briefingJson = briefingJson;
        this.checkedAt = null;
        this.changedAt = null;
        this.changesJson = null;
        return this;
    }

    /** Checked, and nothing had changed. */
    public FlightWatch checked(Instant now) {
        this.checkedAt = now;
        return this;
    }

    /** Checked, and something had: the briefing it was found in becomes
     *  the baseline, so the next check reports only what changed since. */
    public FlightWatch changed(String briefingJson, String changesJson, Instant now) {
        this.briefingJson = briefingJson;
        this.changesJson = changesJson;
        this.changedAt = now;
        this.checkedAt = now;
        return this;
    }
}
