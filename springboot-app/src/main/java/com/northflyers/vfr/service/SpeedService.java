package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.SpeedSample;
import com.northflyers.vfr.repository.SpeedSampleRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The web app's speed over time (SpeedController): samples kept as they
 * come, read back a day at a time, and the oldest let go.
 */
@Service
public class SpeedService {

    /** How long a sample is kept: a year's trend and a month over. */
    static final Duration KEPT = Duration.ofDays(400);

    private final SpeedSampleRepository samples;

    /** The last day old samples were let go, so it happens once a day at
     *  most, on that day's first sample, rather than on a schedule this
     *  app does not otherwise run. */
    private final AtomicReference<LocalDate> pruned = new AtomicReference<>();

    public SpeedService(SpeedSampleRepository samples) {
        this.samples = samples;
    }

    /** Keeps a batch of one source's samples, measured on one page and
     *  kind of device of one build, all at the same moment. */
    @Transactional
    public void record(String source, String page, String device, String version, Map<String, Double> values) {
        Instant now = Instant.now();
        samples.saveAll(values.entrySet().stream()
                .map(e -> new SpeedSample(now, source, e.getKey(), e.getValue(), page, device, version))
                .toList());
        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);
        LocalDate last = pruned.get();
        if (!today.equals(last) && pruned.compareAndSet(last, today)) {
            samples.deleteOlderThan(now.minus(KEPT));
        }
    }

    /** Each day of the last {@code days}, by source, metric and device. */
    @Transactional(readOnly = true)
    public List<SpeedSampleRepository.Day> trend(int days) {
        return samples.daysSince(Instant.now().minus(Duration.ofDays(days)));
    }
}
