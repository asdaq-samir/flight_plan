package com.northflyers.vfr;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Endorsement;
import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.domain.FlightTrack;
import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.MagicLink;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.AircraftRepository;
import com.northflyers.vfr.repository.EndorsementRepository;
import com.northflyers.vfr.repository.FlightRepository;
import com.northflyers.vfr.repository.FlightTrackRepository;
import com.northflyers.vfr.repository.LogbookRepository;
import com.northflyers.vfr.repository.MagicLinkRepository;
import com.northflyers.vfr.repository.PilotRepository;
import com.northflyers.vfr.security.MagicLinkAuthenticationToken;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Deleting an account (App Review 5.1.1(v)), against a real Postgres:
 * what is deleted is decided by the schema's ON DELETE CASCADEs as much
 * as by the code, so every table that holds a pilot's data is counted
 * afterwards -- empty for the deleted pilot, untouched for another.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class AccountDeletionTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    /** The planner, which keeps the pilot's own checkpoint notes. */
    private static HttpServer planner;
    private static final List<String> plannerAsked = new CopyOnWriteArrayList<>();
    private static volatile int plannerStatus = 200;

    @Autowired private MockMvc mockMvc;
    @Autowired private PilotRepository pilots;
    @Autowired private AircraftRepository aircraft;
    @Autowired private FlightRepository flights;
    @Autowired private FlightTrackRepository tracks;
    @Autowired private LogbookRepository logbook;
    @Autowired private EndorsementRepository endorsements;
    @Autowired private MagicLinkRepository magicLinks;
    @Autowired private FindByIndexNameSessionRepository<? extends Session> sessions;
    @Autowired private JdbcTemplate jdbc;

    @BeforeAll
    static void startPlanner() throws IOException {
        planner = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        planner.createContext("/", exchange -> {
            plannerAsked.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath()
                    + " pilot=" + exchange.getRequestHeaders().getFirst("X-Pilot-Id"));
            byte[] body = "{\"removed\":1}".getBytes();
            exchange.sendResponseHeaders(plannerStatus, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        planner.start();
    }

    @AfterAll
    static void stopPlanner() {
        planner.stop(0);
    }

    @DynamicPropertySource
    static void plannerUrl(DynamicPropertyRegistry registry) {
        registry.add("planner-service.base-url", () -> "http://127.0.0.1:" + planner.getAddress().getPort());
    }

    @BeforeEach
    void reset() {
        plannerAsked.clear();
        plannerStatus = 200;
    }

    /** A pilot with one of everything a pilot can have, and a session. */
    private Pilot pilotWithEverything() {
        String email = UUID.randomUUID() + "@example.com";
        Pilot pilot = pilots.save(new Pilot(email, "Test Pilot", null));
        Aircraft plane = aircraft.save(new Aircraft(pilot, "N" + email.substring(0, 5), "C172", 110, 8.5,
                null, null, null, null));
        Flight flight = flights.save(new Flight(pilot, plane, "C81", "KDLH").fileNavLog(List.of(
                new FlightCheckpoint(0, "C81", "departure", 42.3172, -88.0905, 0.0)
                        .withLeg(4.0, 319.0, 322.0, 116.0, 2.1, 0.3),
                new FlightCheckpoint(1, "KDLH", "destination", 46.8421, -92.1936, 323.4)), 2500, 323.6, 171.0, 24.2));
        tracks.save(new FlightTrack(flight.getId(), "test", "[[42.3,-88.1],[46.8,-92.2]]", 2));
        logbook.save(new LogbookEntry(pilot).set(LocalDate.of(2026, 10, 1), "N12345", "C172", "C81-KDLH",
                2.5, 0, 2.5, 1, 0, null));
        endorsements.save(new Endorsement(pilot.getId(), "A.1", LocalDate.of(2026, 9, 1)));
        magicLinks.save(new MagicLink(email, UUID.randomUUID().toString().replace("-", ""), Instant.now().plusSeconds(600)));
        signIn(email);
        return pilot;
    }

    private <S extends Session> void signIn(String email, FindByIndexNameSessionRepository<S> repository) {
        S session = repository.createSession();
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new MagicLinkAuthenticationToken(email));
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
        repository.save(session);
    }

    private void signIn(String email) {
        signIn(email, sessions);
    }

    /** Rows of each table that are the pilot's, by their id and address. */
    private List<Integer> rowsOf(Pilot pilot) {
        Long id = pilot.getId();
        return List.of(
                jdbc.queryForObject("SELECT count(*) FROM pilots WHERE id = ?", Integer.class, id),
                jdbc.queryForObject("SELECT count(*) FROM aircraft WHERE pilot_id = ?", Integer.class, id),
                jdbc.queryForObject("SELECT count(*) FROM flights WHERE pilot_id = ?", Integer.class, id),
                jdbc.queryForObject("SELECT count(*) FROM flight_checkpoints c JOIN flights f ON f.id = c.flight_id "
                        + "WHERE f.pilot_id = ?", Integer.class, id),
                jdbc.queryForObject("SELECT count(*) FROM flight_tracks t JOIN flights f ON f.id = t.flight_id "
                        + "WHERE f.pilot_id = ?", Integer.class, id),
                jdbc.queryForObject("SELECT count(*) FROM logbook_entries WHERE pilot_id = ?", Integer.class, id),
                jdbc.queryForObject("SELECT count(*) FROM pilot_endorsements WHERE pilot_id = ?", Integer.class, id),
                jdbc.queryForObject("SELECT count(*) FROM magic_links WHERE email = ?", Integer.class, pilot.getEmail()),
                sessions.findByPrincipalName(pilot.getEmail()).size());
    }

    @Test
    void deletingAnAccountTakesEverythingThatWasTheirsAndNothingOfAnyoneElses() throws Exception {
        Pilot leaving = pilotWithEverything();
        Pilot staying = pilotWithEverything();
        assertThat(rowsOf(leaving)).allMatch(rows -> rows > 0);
        List<Integer> before = rowsOf(staying);

        mockMvc.perform(delete("/api/me").with(csrf())
                        .with(authentication(new MagicLinkAuthenticationToken(leaving.getEmail()))))
                .andExpect(status().isNoContent());

        assertThat(rowsOf(leaving)).containsOnly(0);
        // A flight's nav log and track have no pilot of their own: none may
        // be left without its flight.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flight_checkpoints WHERE flight_id NOT IN "
                + "(SELECT id FROM flights)", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flight_tracks WHERE flight_id NOT IN "
                + "(SELECT id FROM flights)", Integer.class)).isZero();
        assertThat(rowsOf(staying)).isEqualTo(before);
        // The planner was asked to forget the pilot's own notes, by their id.
        assertThat(plannerAsked).containsExactly("DELETE /api/checkpoint-notes/mine pilot=" + leaving.getId());
    }

    @Test
    void whenThePlannerCannotTakeTheNotesNothingIsDeleted() throws Exception {
        Pilot pilot = pilotWithEverything();
        List<Integer> before = rowsOf(pilot);
        plannerStatus = 503;

        mockMvc.perform(delete("/api/me").with(csrf())
                        .with(authentication(new MagicLinkAuthenticationToken(pilot.getEmail()))))
                .andExpect(status().isBadGateway());

        assertThat(rowsOf(pilot)).isEqualTo(before);
    }

    @Test
    void nobodySignedInDeletesNothing() throws Exception {
        mockMvc.perform(delete("/api/me").with(csrf())).andExpect(status().isUnauthorized());
        assertThat(plannerAsked).isEmpty();
    }
}
