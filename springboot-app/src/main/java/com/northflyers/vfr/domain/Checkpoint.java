package com.northflyers.vfr.domain;

import com.fasterxml.jackson.annotation.JsonIgnore;
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
 * A scored waypoint candidate belonging to a {@link Route} -- one row per
 * checkpoint, not a jsonb blob on the route itself. Normalized this way so
 * a checkpoint can be queried/indexed on its own (by category, by score)
 * without unpacking JSON, and so the schema evolves through ordinary
 * migrations instead of being whatever shape Jackson happened to serialize.
 */
@Entity
@Table(name = "checkpoints")
public class Checkpoint {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "route_id", nullable = false)
    @JsonIgnore // avoid re-serializing the parent route this checkpoint already came from
    private Route route;

    @Column(name = "osm_id", nullable = false)
    private String osmId;

    @Column(nullable = false)
    private String category;

    private String name;

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lon;

    @Column(name = "along_track_nm", nullable = false)
    private double alongTrackNm;

    @Column(name = "predicted_score", nullable = false)
    private double predictedScore;

    protected Checkpoint() {
        // JPA
    }

    public Checkpoint(String osmId, String category, String name, double lat, double lon,
            double alongTrackNm, double predictedScore) {
        this.osmId = osmId;
        this.category = category;
        this.name = name;
        this.lat = lat;
        this.lon = lon;
        this.alongTrackNm = alongTrackNm;
        this.predictedScore = predictedScore;
    }

    void setRoute(Route route) {
        this.route = route;
    }

    public Long getId() {
        return id;
    }

    public String getOsmId() {
        return osmId;
    }

    public String getCategory() {
        return category;
    }

    public String getName() {
        return name;
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

    public double getPredictedScore() {
        return predictedScore;
    }
}
