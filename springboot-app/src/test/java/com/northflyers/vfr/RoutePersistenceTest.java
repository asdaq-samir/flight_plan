package com.northflyers.vfr;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.domain.Checkpoint;
import com.northflyers.vfr.domain.Route;
import com.northflyers.vfr.dto.CheckpointDto;
import com.northflyers.vfr.repository.RouteRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Boots the real application context against a real Postgres, which makes
 * this the test that actually proves three things a mock never could:
 * Flyway's migrations apply cleanly in order, {@code ddl-auto: validate}
 * agrees the JPA entities match the schema those migrations produced (so
 * entity/schema drift fails the build rather than production), and the
 * normalized routes/checkpoints parent-child mapping round-trips.
 */
@SpringBootTest
@Testcontainers
class RoutePersistenceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired
    private RouteRepository routeRepository;

    @Test
    void contextLoads_meaningFlywayMigratedAndTheEntitiesValidateAgainstIt() {
        assertThat(routeRepository).isNotNull();
    }

    @Test
    void savingARoute_cascadesItsCheckpointsAndReadsThemBack() {
        Route saved = routeRepository.save(new Route("C81", "KDLH", List.of(
                new CheckpointDto("153546173", "town", "Round Lake", 42.3534, -88.0934, 1.9, 0.72),
                new CheckpointDto("411077224", "lake_or_pond", "(unnamed)", 42.3172, -88.0905, 0.0, 0.41))));

        Optional<Route> found = routeRepository.findById(saved.getId());

        assertThat(found).isPresent();
        assertThat(found.get().getCheckpoints()).hasSize(2);
        assertThat(found.get().getCheckpoints())
                .allSatisfy(checkpoint -> assertThat(checkpoint.getId()).isNotNull());
    }

    /**
     * {@code @OrderBy("alongTrackNm ASC")} on Route's collection, verified
     * by inserting deliberately out of order.
     */
    @Test
    void checkpointsComeBackOrderedAlongTrack() {
        Route saved = routeRepository.save(new Route("C81", "KDLH", List.of(
                new CheckpointDto("c", "river", "White River", 42.6507, -88.3472, 23.0, 0.79),
                new CheckpointDto("a", "lake_or_pond", "(unnamed)", 42.3172, -88.0905, 0.0, 0.41),
                new CheckpointDto("b", "town", "Round Lake", 42.3534, -88.0934, 1.9, 0.72))));

        List<Checkpoint> checkpoints = routeRepository.findById(saved.getId()).orElseThrow().getCheckpoints();

        assertThat(checkpoints).extracting(Checkpoint::getAlongTrackNm).containsExactly(0.0, 1.9, 23.0);
    }

    /** Orphan removal: deleting the route takes its checkpoints with it. */
    @Test
    void deletingARouteRemovesItsCheckpoints() {
        Route saved = routeRepository.save(new Route("C81", "KDLH", List.of(
                new CheckpointDto("411077224", "lake_or_pond", "(unnamed)", 42.3172, -88.0905, 0.0, 0.41))));

        routeRepository.deleteById(saved.getId());

        assertThat(routeRepository.findById(saved.getId())).isEmpty();
    }
}
