package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;

/**
 * One measurement of the web app's speed (V25): a metric's value, where
 * it came from -- a pilot's browser ("field") or the nightly lab run
 * ("lab") -- the page and kind of device, and the build or commit. Nothing
 * that says who measured it.
 */
@Entity
@Table(name = "speed_samples")
@Getter
public class SpeedSample {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Instant recordedAt;

    @Column(nullable = false, length = 5)
    private String source;

    @Column(nullable = false, length = 40)
    private String metric;

    @Column(nullable = false)
    private double value;

    @Column(nullable = false, length = 40)
    private String page;

    @Column(nullable = false, length = 10)
    private String device;

    @Column(nullable = false, length = 40)
    private String version;

    protected SpeedSample() {
        // JPA
    }

    public SpeedSample(Instant recordedAt, String source, String metric, double value, String page, String device, String version) {
        this.recordedAt = recordedAt;
        this.source = source;
        this.metric = metric;
        this.value = value;
        this.page = page;
        this.device = device;
        this.version = version;
    }
}
