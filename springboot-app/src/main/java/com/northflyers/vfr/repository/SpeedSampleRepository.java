package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.SpeedSample;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface SpeedSampleRepository extends JpaRepository<SpeedSample, Long> {

    /** A day of one metric from one source on one kind of device. */
    interface Day {
        String getDay();

        String getSource();

        String getMetric();

        String getDevice();

        double getP50();

        double getP75();

        long getCount();

        /** The highest build or commit seen that day: the lab's commit. */
        String getVersion();
    }

    /** Each day's median and 75th percentile since {@code since}, by UTC
     *  day, source, metric and device, oldest first. The 75th is what Core
     *  Web Vitals judge a site by (web.dev/articles/vitals). */
    @Query(value = """
            SELECT to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, source, metric, device,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS p50,
                   percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
                   count(*) AS count, max(version) AS version
            FROM speed_samples
            WHERE recorded_at >= :since
            GROUP BY 1, 2, 3, 4
            ORDER BY 1, 2, 3, 4""", nativeQuery = true)
    List<Day> daysSince(@Param("since") Instant since);

    @Modifying
    @Transactional
    @Query("DELETE FROM SpeedSample s WHERE s.recordedAt < :before")
    int deleteOlderThan(@Param("before") Instant before);
}
