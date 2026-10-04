package com.northflyers.vfr;

import static org.assertj.core.api.Assertions.assertThat;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.LogbookRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** The logbook's half of the schema (V12) against a real Postgres: the
 *  migration applies, the entities validate against it, and a pilot's
 *  entries come back newest first and to no one else. */
@SpringBootTest
@Testcontainers
class LogbookPersistenceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    @Autowired
    private PilotRepository pilots;

    @Autowired
    private LogbookRepository logbook;

    private Pilot newPilot() {
        String unique = UUID.randomUUID().toString();
        return pilots.save(new Pilot(unique + "@example.com", "Test Pilot", "sub-" + unique));
    }

    @Test
    void aPilotsEntriesComeBackNewestFirstAndToThemAlone() {
        Pilot pilot = newPilot();
        Pilot other = newPilot();
        logbook.save(new LogbookEntry(pilot).set(LocalDate.of(2026, 9, 1), "N12345", "C172", "C81 KDLH", 3.4, 0, 3.4, 1, 0, null));
        LogbookEntry newer = logbook.save(new LogbookEntry(pilot)
                .set(LocalDate.of(2026, 9, 20), "N12345", "C172", "C81 local", 1.2, 1.0, 0, 0, 3, "night landings"));
        logbook.save(new LogbookEntry(other).set(LocalDate.of(2026, 9, 25), null, null, null, 1.0, 0, 0, 1, 0, null));

        assertThat(logbook.findByPilotIdOrderByFlownOnDescIdDesc(pilot.getId()))
                .extracting(LogbookEntry::getRoute).containsExactly("C81 local", "C81 KDLH");
        assertThat(logbook.findByIdAndPilotId(newer.getId(), other.getId())).isEmpty();
    }

    @Test
    void aPilotsCurrencyDatesAreKept() {
        Pilot pilot = newPilot();
        pilot.setCurrencyDates(LocalDate.of(2025, 6, 14), LocalDate.of(2027, 6, 30));
        pilots.save(pilot);

        Pilot found = pilots.findById(pilot.getId()).orElseThrow();
        assertThat(found.getFlightReviewOn()).isEqualTo(LocalDate.of(2025, 6, 14));
        assertThat(found.getMedicalExpiresOn()).isEqualTo(LocalDate.of(2027, 6, 30));
    }
}
