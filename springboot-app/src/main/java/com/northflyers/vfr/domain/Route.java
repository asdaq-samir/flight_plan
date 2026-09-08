package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A saved/scored route. Checkpoints are stored as a single jsonb column
 * rather than a normalized child table -- deliberate for now, since the
 * candidate/checkpoint shape is still moving on the Python side (12
 * categories added in the same session this API was built) and a rigid
 * relational schema would just mean migration churn.
 */
@Entity
@Table(name = "routes")
public class Route {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String departureIdent;

    @Column(nullable = false)
    private String destinationIdent;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<Checkpoint> checkpoints;

    @Column(nullable = false)
    private Instant createdAt;

    protected Route() {
        // JPA
    }

    public Route(String departureIdent, String destinationIdent, List<Checkpoint> checkpoints) {
        this.departureIdent = departureIdent;
        this.destinationIdent = destinationIdent;
        this.checkpoints = checkpoints;
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public String getDepartureIdent() {
        return departureIdent;
    }

    public String getDestinationIdent() {
        return destinationIdent;
    }

    public List<Checkpoint> getCheckpoints() {
        return checkpoints;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
