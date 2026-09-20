package com.northflyers.vfr;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.AircraftRepository;
import com.northflyers.vfr.repository.FlightRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The pilot/aircraft/flight half of the schema, against a real Postgres.
 *
 * <p>Worth a container rather than a mock: Flyway's migrations have to
 * apply and {@code ddl-auto: validate} has to accept the entities against
 * the result, the unique constraints are enforced by the database and
 * nowhere else, and the {@code ON DELETE SET NULL} behaviour that keeps a
 * flown flight after its aeroplane is sold is a property of the DDL, not
 * of the entities.
 */
@SpringBootTest
@Testcontainers
class FlightPersistenceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    @Autowired
    private PilotRepository pilots;

    @Autowired
    private AircraftRepository aircraft;

    @Autowired
    private FlightRepository flights;

    private Pilot newPilot() {
        String unique = UUID.randomUUID().toString();
        return pilots.save(new Pilot(unique + "@example.com", "Test Pilot", "sub-" + unique));
    }

    private List<FlightCheckpoint> navLog() {
        return List.of(
                new FlightCheckpoint(0, "C81", "departure", 42.3172, -88.0905, 0.0)
                        .withLeg(4.0, 319.0, 322.0, 116.0, 2.1, 0.3),
                new FlightCheckpoint(1, "Long Lake", "lake_or_pond", 42.3534, -88.0934, 3.9)
                        .withLeg(10.5, 328.0, 332.0, 116.0, 5.4, 0.8),
                // The destination: no leg leaves it.
                new FlightCheckpoint(2, "KDLH", "destination", 46.8421, -92.1936, 323.4));
    }

    @Test
    void aFiledNavLogRoundTripsInOrder() {
        Pilot pilot = newPilot();
        Flight saved = flights.save(new Flight(pilot, null, "C81", "KDLH")
                .fileNavLog(navLog(), 2500, 323.6, 171.0, 24.2));

        Flight found = flights.findById(saved.getId()).orElseThrow();

        assertThat(found.getCheckpoints()).extracting(FlightCheckpoint::getName)
                .containsExactly("C81", "Long Lake", "KDLH");
        assertThat(found.getCruiseAltitudeFt()).isEqualTo(2500);
        assertThat(found.getTotalFuelGal()).isEqualTo(24.2);
    }

    /**
     * The destination row has no leg after it, and that has to survive the
     * round trip as null rather than as zero -- a zero there reads as a
     * leg of no distance flown in no time.
     */
    @Test
    void theDestinationKeepsNullLegNumbers() {
        Pilot pilot = newPilot();
        Flight saved = flights.save(new Flight(pilot, null, "C81", "KDLH")
                .fileNavLog(navLog(), 2500, 323.6, 171.0, 24.2));

        FlightCheckpoint last = flights.findById(saved.getId()).orElseThrow().getCheckpoints().get(2);

        assertThat(last.getLegDistanceNm()).isNull();
        assertThat(last.getEteMin()).isNull();
        assertThat(last.getFuelGal()).isNull();
    }

    @Test
    void refilingANavLogReplacesItRatherThanAppending() {
        Pilot pilot = newPilot();
        Flight saved = flights.save(new Flight(pilot, null, "C81", "KDLH")
                .fileNavLog(navLog(), 2500, 323.6, 171.0, 24.2));

        Flight refiled = flights.findById(saved.getId()).orElseThrow();
        refiled.fileNavLog(List.of(
                new FlightCheckpoint(0, "C81", "departure", 42.3172, -88.0905, 0.0),
                new FlightCheckpoint(1, "KDLH", "destination", 46.8421, -92.1936, 323.4)),
                4500, 323.4, 168.0, 23.8);
        flights.saveAndFlush(refiled);

        assertThat(flights.findById(saved.getId()).orElseThrow().getCheckpoints()).hasSize(2);
    }

    /** Enforced by the database, so only a real one proves it. */
    @Test
    void aPilotCannotRegisterTheSameTailNumberTwice() {
        Pilot pilot = newPilot();
        aircraft.saveAndFlush(new Aircraft(pilot, "N12345", "C172", 110.0, 8.5, null));

        assertThatThrownBy(() -> aircraft.saveAndFlush(new Aircraft(pilot, "N12345", "C172", 110.0, 8.5, null)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /** Two pilots may each have an N12345; the constraint is per pilot. */
    @Test
    void differentPilotsMayHoldTheSameTailNumber() {
        aircraft.saveAndFlush(new Aircraft(newPilot(), "N12345", "C172", 110.0, 8.5, null));

        assertThat(aircraft.saveAndFlush(new Aircraft(newPilot(), "N12345", "C172", 110.0, 8.5, null)).getId())
                .isNotNull();
    }

    /**
     * Selling the aeroplane must not delete the record of having flown it:
     * the flight survives with a null aircraft.
     */
    @Test
    void deletingAnAircraftKeepsTheFlightsFlownInIt() {
        Pilot pilot = newPilot();
        Aircraft plane = aircraft.saveAndFlush(new Aircraft(pilot, "N54321", "C172", 110.0, 8.5, 40.0));
        Flight saved = flights.saveAndFlush(new Flight(pilot, plane, "C81", "KDLH"));

        aircraft.deleteById(plane.getId());
        aircraft.flush();

        Flight found = flights.findById(saved.getId()).orElseThrow();
        assertThat(found.getDepartureIdent()).isEqualTo("C81");
        assertThat(found.getAircraft()).isNull();
    }

    /** Deleting the pilot does cascade -- their flights are theirs. */
    @Test
    void deletingAPilotRemovesTheirFlights() {
        Pilot pilot = newPilot();
        Flight saved = flights.saveAndFlush(new Flight(pilot, null, "C81", "KDLH"));

        pilots.deleteById(pilot.getId());
        pilots.flush();

        assertThat(flights.findById(saved.getId())).isEmpty();
    }

    @Test
    void flightsAndAircraftAreScopedToTheirPilot() {
        Pilot mine = newPilot();
        Pilot theirs = newPilot();
        Flight flight = flights.saveAndFlush(new Flight(mine, null, "C81", "KDLH"));

        assertThat(flights.findByIdAndPilotId(flight.getId(), mine.getId())).isPresent();
        assertThat(flights.findByIdAndPilotId(flight.getId(), theirs.getId())).isEmpty();
    }

    @Test
    void aPilotIsFoundByGoogleSubjectAndByEmail() {
        Pilot pilot = newPilot();

        assertThat(pilots.findByGoogleSubject(pilot.getGoogleSubject())).isPresent();
        assertThat(pilots.findByEmail(pilot.getEmail())).isPresent();
        assertThat(pilots.findByGoogleSubject("nobody")).isEmpty();
    }
}
