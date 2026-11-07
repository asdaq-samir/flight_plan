package com.northflyers.wingtip.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.northflyers.wingtip.domain.Flight;
import com.northflyers.wingtip.domain.FlightWatch;
import com.northflyers.wingtip.domain.Pilot;
import com.northflyers.wingtip.dto.BriefingChangeDto;
import com.northflyers.wingtip.dto.BriefingSourceDto;
import com.northflyers.wingtip.dto.FlightWatchDto;
import com.northflyers.wingtip.planner.model.PlannerChangesWords;
import com.northflyers.wingtip.planner.model.PlannerSentence;
import com.northflyers.wingtip.planner.model.PlannerSource;
import com.northflyers.wingtip.repository.FlightRepository;
import com.northflyers.wingtip.repository.FlightWatchRepository;
import com.northflyers.wingtip.repository.PilotRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.test.util.ReflectionTestUtils;

/** The flight watch without a database or a planner: a watch starts from
 *  the briefing now; a check that finds a change keeps it, moves the
 *  baseline and emails the pilot once; one that finds none sends nothing;
 *  a planner that fails leaves the watch for the next run and the rest
 *  are checked; a flight gone is deleted; another pilot's is not theirs. */
@ExtendWith(MockitoExtension.class)
class FlightWatchServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-03T20:00:00Z");
    private static final Instant DEPART = Instant.parse("2026-11-04T14:00:00Z");
    /** Two briefings as the planner writes them: never read inside. */
    private static final String THEN = "{\"forecast\":{\"min_ceiling_ft\":4000}}";
    private static final String LATER = "{\"forecast\":{\"min_ceiling_ft\":1500}}";
    private static final String CEILING = "KDLH's ceiling is forecast 1,500 ft, down from 4,000.";

    @Mock
    private FlightWatchRepository watches;

    @Mock
    private FlightRepository flights;

    @Mock
    private PilotRepository pilots;

    @Mock
    private PlannerClient planner;

    @Mock
    private Mailer mail;

    private FlightWatchService service;

    private final Pilot pilot = pilotWithId(1L);

    @BeforeEach
    void service() {
        service = new FlightWatchService(watches, flights, pilots, planner, mail, "https://maps.example.com/");
    }

    private static Pilot pilotWithId(long id) {
        Pilot pilot = new Pilot("pilot@example.com", "Test Pilot", "sub-" + id);
        ReflectionTestUtils.setField(pilot, "id", id);
        return pilot;
    }

    /** C81 to KDLH by way of KJVL, 205 minutes en route. */
    private static Flight flightWithId(long id, Pilot pilot) {
        Flight flight = new Flight(pilot, null, "C81", "KDLH").withStops(List.of("KJVL"));
        flight.fileNavLog(List.of(), 4500, 323.4, 205.0, 29.0);
        ReflectionTestUtils.setField(flight, "id", id);
        return flight;
    }

    private static PlannerChangesWords changed() {
        return new PlannerChangesWords().changed(true)
                .sentences(List.of(new PlannerSentence().text(CEILING).sources(List.of("taf:KDLH"))))
                .sources(List.of(new PlannerSource().id("taf:KDLH").label("TAF KDLH 031720Z")
                        .text("KDLH 031720Z 0318/0418 ...")))
                .model("claude-haiku-5-5");
    }

    private static PlannerChangesWords unchanged() {
        return new PlannerChangesWords().changed(false).sentences(List.of()).sources(List.of())
                .model("claude-haiku-5-5");
    }

    @Test
    void watchingAFlightKeepsTheBriefingNowAsTheBaseline() {
        given(flights.findByIdAndPilotId(7L, 1L)).willReturn(Optional.of(flightWithId(7L, pilot)));
        given(planner.briefing("C81", "KDLH", List.of("KJVL"), DEPART, 205.0)).willReturn(THEN);
        given(watches.findById(7L)).willReturn(Optional.empty());
        given(watches.save(any(FlightWatch.class))).willAnswer(call -> call.getArgument(0));

        FlightWatchDto watch = service.watch(pilot, 7L, DEPART).orElseThrow();

        assertThat(watch.flightId()).isEqualTo(7L);
        assertThat(watch.departAt()).isEqualTo(DEPART);
        assertThat(watch.checkedAt()).isNull();
        assertThat(watch.changes()).isEmpty();
        assertThat(watch.sources()).isEmpty();
        ArgumentCaptor<FlightWatch> kept = ArgumentCaptor.forClass(FlightWatch.class);
        verify(watches).save(kept.capture());
        assertThat(kept.getValue().getBriefingJson()).isEqualTo(THEN);
        assertThat(kept.getValue().getPilotId()).isEqualTo(1L);
    }

    @Test
    void anotherPilotsFlightIsNeitherWatchedReadNorUnwatched() {
        given(flights.findByIdAndPilotId(7L, 1L)).willReturn(Optional.empty());
        given(watches.findByFlightIdAndPilotId(7L, 1L)).willReturn(Optional.empty());

        assertThat(service.watch(pilot, 7L, DEPART)).isEmpty();
        assertThat(service.watchOf(pilot, 7L)).isEmpty();
        assertThat(service.unwatch(pilot, 7L)).isFalse();

        verify(planner, never()).briefing(any(), any(), any(), any(), any());
        verify(watches, never()).save(any());
        verify(watches, never()).delete(any(FlightWatch.class));
    }

    @Test
    void aChangedBriefingIsKeptAndThePilotEmailedOnce() {
        FlightWatch watch = new FlightWatch(7L, 1L, DEPART, THEN, NOW.minus(Duration.ofHours(1)));
        given(watches.due(any(), any(), any(), any())).willReturn(List.of(watch));
        given(flights.findById(7L)).willReturn(Optional.of(flightWithId(7L, pilot)));
        given(planner.briefing("C81", "KDLH", List.of("KJVL"), DEPART, 205.0)).willReturn(LATER);
        given(planner.changes("C81", "KDLH", List.of("KJVL"), THEN, LATER)).willReturn(changed());
        given(pilots.findById(1L)).willReturn(Optional.of(pilot));
        given(watches.save(any(FlightWatch.class))).willAnswer(call -> call.getArgument(0));

        assertThat(service.check(NOW)).isEqualTo(1);

        ArgumentCaptor<SimpleMailMessage> sent = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mail).send(sent.capture());
        assertThat(sent.getValue().getTo()).containsExactly("pilot@example.com");
        assertThat(sent.getValue().getSubject()).isEqualTo("Your flight C81 to KDLH: what changed");
        assertThat(sent.getValue().getText()).isEqualTo(CEILING + "\n"
                + "\nOpen the app to see the briefing."
                + "\nhttps://maps.example.com/app/plan?dep=C81&dest=KDLH&stops=KJVL");
        // The briefing it was found in is the baseline now.
        assertThat(watch.getBriefingJson()).isEqualTo(LATER);
        assertThat(watch.getChangedAt()).isEqualTo(NOW);
        assertThat(watch.getCheckedAt()).isEqualTo(NOW);
        // What the app shows: the planner's words and the reports, read back.
        given(watches.findByFlightIdAndPilotId(7L, 1L)).willReturn(Optional.of(watch));
        FlightWatchDto shown = service.watchOf(pilot, 7L).orElseThrow();
        assertThat(shown.changes()).extracting(BriefingChangeDto::text).containsExactly(CEILING);
        assertThat(shown.changes().get(0).sources()).containsExactly("taf:KDLH");
        assertThat(shown.sources()).extracting(BriefingSourceDto::label).containsExactly("TAF KDLH 031720Z");

        // Half an hour on, nothing new: no second email, the baseline kept,
        // only the check's time moved.
        given(planner.changes("C81", "KDLH", List.of("KJVL"), LATER, LATER)).willReturn(unchanged());
        Instant later = NOW.plus(Duration.ofMinutes(30));
        assertThat(service.check(later)).isZero();
        verify(mail, times(1)).send(any());
        assertThat(watch.getBriefingJson()).isEqualTo(LATER);
        assertThat(watch.getChangedAt()).isEqualTo(NOW);
        assertThat(watch.getCheckedAt()).isEqualTo(later);
    }

    @Test
    void wordsThatCouldNotBeWrittenKeepTheBaselineForTheNextCheck() {
        FlightWatch watch = new FlightWatch(7L, 1L, DEPART, THEN, NOW);
        given(watches.due(any(), any(), any(), any())).willReturn(List.of(watch));
        given(flights.findById(7L)).willReturn(Optional.of(flightWithId(7L, pilot)));
        given(planner.briefing("C81", "KDLH", List.of("KJVL"), DEPART, 205.0)).willReturn(LATER);
        given(planner.changes("C81", "KDLH", List.of("KJVL"), THEN, LATER))
                .willReturn(new PlannerChangesWords().changed(false).sentences(List.of()).sources(List.of())
                        .unavailable("Claude did not answer"));
        given(watches.save(any(FlightWatch.class))).willAnswer(call -> call.getArgument(0));

        assertThat(service.check(NOW)).isZero();

        assertThat(watch.getBriefingJson()).isEqualTo(THEN);
        assertThat(watch.getCheckedAt()).isEqualTo(NOW);
        assertThat(watch.getChangedAt()).isNull();
        verify(mail, never()).send(any());
    }

    @Test
    void aPlannerFailureLeavesTheWatchAndTheRestAreChecked() {
        FlightWatch first = new FlightWatch(7L, 1L, DEPART, THEN, NOW);
        FlightWatch second = new FlightWatch(8L, 1L, DEPART, THEN, NOW);
        given(watches.due(any(), any(), any(), any())).willReturn(List.of(first, second));
        given(flights.findById(7L)).willReturn(Optional.of(flightWithId(7L, pilot)));
        given(flights.findById(8L)).willReturn(Optional.of(flightWithId(8L, pilot)));
        // The same route twice: the planner is down for the first ask and back for the second.
        given(planner.briefing("C81", "KDLH", List.of("KJVL"), DEPART, 205.0))
                .willThrow(new PlannerClient.Unavailable("the planner could not be reached for the briefing"))
                .willReturn(LATER);
        given(planner.changes("C81", "KDLH", List.of("KJVL"), THEN, LATER)).willReturn(unchanged());
        given(watches.save(any(FlightWatch.class))).willAnswer(call -> call.getArgument(0));

        assertThat(service.check(NOW)).isZero();

        assertThat(first.getCheckedAt()).isNull();
        assertThat(first.getBriefingJson()).isEqualTo(THEN);
        assertThat(second.getCheckedAt()).isEqualTo(NOW);
        verify(watches, never()).delete(any(FlightWatch.class));
        verify(mail, never()).send(any());
    }

    @Test
    void aRunEndsTheWatchesPastDepartureAndAsksForThoseInTheWindow() {
        service.check(NOW);

        verify(watches).deleteDepartedBefore(NOW.minus(Duration.ofHours(2)));
        verify(watches).due(eq(NOW.minus(Duration.ofHours(2))), eq(NOW.plus(Duration.ofHours(36))),
                eq(NOW.minus(Duration.ofMinutes(20))), any());
        verify(planner, never()).briefing(any(), any(), any(), any(), any());
    }

    @Test
    void unwatchingEndsThePilotsOwnWatch() {
        FlightWatch watch = new FlightWatch(7L, 1L, DEPART, THEN, NOW);
        given(watches.findByFlightIdAndPilotId(7L, 1L)).willReturn(Optional.of(watch));

        assertThat(service.unwatch(pilot, 7L)).isTrue();

        verify(watches).delete(watch);
    }
}
