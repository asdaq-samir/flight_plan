package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;

/**
 * A flight's flown track, saved to the pilot's account for its debrief:
 * the file it came from and its points as JSON, read back whole. One a
 * flight, keyed by it; a new one replaces the old.
 */
@Entity
@Table(name = "flight_tracks")
@Getter
public class FlightTrack {

    @Id
    private Long flightId;

    @Column(nullable = false, length = 120)
    private String source;

    @Column(nullable = false, columnDefinition = "text")
    private String points;

    @Column(nullable = false)
    private int pointCount;

    @Column(nullable = false)
    private Instant savedAt;

    protected FlightTrack() {
        // JPA
    }

    public FlightTrack(Long flightId, String source, String points, int pointCount) {
        this.flightId = flightId;
        replace(source, points, pointCount);
    }

    public void replace(String source, String points, int pointCount) {
        this.source = source;
        this.points = points;
        this.pointCount = pointCount;
        this.savedAt = Instant.now();
    }
}
