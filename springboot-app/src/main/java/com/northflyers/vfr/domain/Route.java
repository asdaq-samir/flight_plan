package com.northflyers.vfr.domain;

import com.northflyers.vfr.dto.CheckpointDto;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * A saved/scored route. Checkpoints are a normalized child table
 * (see {@link Checkpoint}), owned by this entity -- cascading persist and
 * orphan-removal, since a checkpoint never outlives its route.
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

    @OneToMany(mappedBy = "route", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @OrderBy("alongTrackNm ASC")
    private List<Checkpoint> checkpoints = new ArrayList<>();

    @Column(nullable = false)
    private Instant createdAt;

    protected Route() {
        // JPA
    }

    /**
     * Converts model-service's response DTOs into owned {@link Checkpoint}
     * entities and sets {@code createdAt} to now.
     */
    public Route(String departureIdent, String destinationIdent, List<CheckpointDto> checkpoints) {
        this.departureIdent = departureIdent;
        this.destinationIdent = destinationIdent;
        this.createdAt = Instant.now();
        this.checkpoints = checkpoints.stream()
                .map(dto -> new Checkpoint(dto.osmId(), dto.category(), dto.name(), dto.lat(), dto.lon(),
                        dto.alongTrackNm(), dto.predictedScore()))
                .collect(Collectors.toList());
        this.checkpoints.forEach(checkpoint -> checkpoint.setRoute(this));
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
