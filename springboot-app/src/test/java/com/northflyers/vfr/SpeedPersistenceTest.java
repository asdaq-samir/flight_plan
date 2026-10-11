package com.northflyers.vfr;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.domain.SpeedSample;
import com.northflyers.vfr.repository.SpeedSampleRepository;
import com.northflyers.vfr.service.SpeedService;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** The speed trend's table (V25) against a real Postgres: the migration
 *  applies, the entity validates against it, a day's samples come back as
 *  their median and 75th percentile, and a sample past its 400 days goes. */
@SpringBootTest
@Testcontainers
class SpeedPersistenceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    @Autowired
    private SpeedSampleRepository samples;

    @Autowired
    private SpeedService speed;

    @BeforeEach
    void empty() {
        samples.deleteAll();
    }

    @Test
    void aDayComesBackAsItsMedianAndSeventyFifthPercentile() {
        for (double lcp : new double[] {1000, 2000, 3000, 4000, 5000}) {
            speed.record("field", "plan", "phone", "abc1234", Map.of("LCP", lcp));
        }
        speed.record("field", "plan", "desktop", "abc1234", Map.of("LCP", 900.0));

        var days = speed.trend(7);

        assertThat(days).hasSize(2);
        var phone = days.stream().filter(d -> d.getDevice().equals("phone")).findFirst().orElseThrow();
        assertThat(phone.getSource()).isEqualTo("field");
        assertThat(phone.getMetric()).isEqualTo("LCP");
        assertThat(phone.getCount()).isEqualTo(5);
        assertThat(phone.getP50()).isEqualTo(3000);
        assertThat(phone.getP75()).isEqualTo(4000);
        assertThat(phone.getDay()).matches("\\d{4}-\\d{2}-\\d{2}");
    }

    @Test
    void aSamplePastItsKeepingIsLetGo() {
        samples.save(new SpeedSample(Instant.now().minus(Duration.ofDays(401)), "lab", "open_app", 1100, "plan", "phone", "old"));
        samples.save(new SpeedSample(Instant.now().minus(Duration.ofDays(30)), "lab", "open_app", 1000, "plan", "phone", "new"));

        assertThat(samples.deleteOlderThan(Instant.now().minus(Duration.ofDays(400)))).isEqualTo(1);
        assertThat(samples.findAll()).extracting(SpeedSample::getVersion).containsExactly("new");
    }
}
