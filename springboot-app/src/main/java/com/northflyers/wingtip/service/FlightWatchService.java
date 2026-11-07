package com.northflyers.wingtip.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.northflyers.wingtip.domain.Flight;
import com.northflyers.wingtip.domain.FlightWatch;
import com.northflyers.wingtip.domain.Pilot;
import com.northflyers.wingtip.dto.BriefingChangeDto;
import com.northflyers.wingtip.dto.BriefingSourceDto;
import com.northflyers.wingtip.dto.FlightWatchDto;
import com.northflyers.wingtip.planner.model.PlannerChangesWords;
import com.northflyers.wingtip.planner.model.PlannerSentence;
import com.northflyers.wingtip.repository.FlightRepository;
import com.northflyers.wingtip.repository.FlightWatchRepository;
import com.northflyers.wingtip.repository.PilotRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * The flight watch: a pilot watches a saved flight, and up to its
 * departure this app re-briefs it on a schedule, asks the planner what
 * changed in words, keeps the latest changes for the app to show
 * ({@link FlightWatchDto}) and emails the pilot when something did.
 *
 * <p>Nothing aviation is read or worked out here. The briefing is the
 * planner's document, kept as it came to be diffed against the next;
 * what changed is the planner's answer, carried to the app and the
 * email as it was given. A pilot's watch is theirs alone, scoped the
 * way {@link FlightService} scopes their flights.
 */
@Service
public class FlightWatchService {

    private static final Logger log = LoggerFactory.getLogger(FlightWatchService.class);

    /** The window a watch is checked in: from two hours past departure
     *  back to 36 hours before it -- the night before and the morning of,
     *  as a pilot re-briefs. A flight more than two hours gone is left to
     *  expire: it cannot be re-briefed. */
    static final Duration AFTER_DEPARTURE = Duration.ofHours(2);
    static final Duration BEFORE_DEPARTURE = Duration.ofHours(36);
    /** No two checks of one watch closer than this, however the schedule
     *  fires: a briefing is weather fetched along the route, and the words
     *  a Claude call this app pays for. */
    static final Duration AGAIN_AFTER = Duration.ofMinutes(20);
    /** Watches a run checks at most, nearest departure first: each is two
     *  planner calls of tens of seconds, and the next run is half an hour
     *  after this one ends. */
    static final int MOST_A_RUN = 50;

    private final FlightWatchRepository watches;
    private final FlightRepository flights;
    private final PilotRepository pilots;
    private final PlannerClient planner;
    private final Mailer mail;
    /** Where the email's link into the app points (the magic link's and
     *  the instructor emails' app.public-base-url); blank where this
     *  deployment sends no mail, and then there is no link. */
    private final String publicBaseUrl;

    public FlightWatchService(FlightWatchRepository watches, FlightRepository flights, PilotRepository pilots,
                              PlannerClient planner, Mailer mail,
                              @Value("${app.public-base-url:}") String publicBaseUrl) {
        this.watches = watches;
        this.flights = flights;
        this.pilots = pilots;
        this.planner = planner;
        this.mail = mail;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    /**
     * Watches the pilot's flight up to {@code departAt}: the briefing now
     * is fetched and kept as the baseline, so the first check has
     * something to diff against. A flight watched already is watched
     * again from now. Empty where the flight is not theirs.
     *
     * @throws PlannerClient.Unavailable when the planner cannot brief it;
     *     nothing is kept then
     */
    public Optional<FlightWatchDto> watch(Pilot pilot, Long flightId, Instant departAt) {
        return flights.findByIdAndPilotId(flightId, pilot.getId()).map(flight -> {
            String briefing = briefingOf(flight, departAt);
            Instant now = Instant.now();
            FlightWatch watch = watches.findById(flight.getId())
                    .map(kept -> kept.rewatch(departAt, briefing))
                    .orElseGet(() -> new FlightWatch(flight.getId(), pilot.getId(), departAt, briefing, now));
            return dto(watches.save(watch));
        });
    }

    /** The pilot's watch on the flight, or empty where there is none or
     *  the flight is not theirs. */
    public Optional<FlightWatchDto> watchOf(Pilot pilot, Long flightId) {
        return watches.findByFlightIdAndPilotId(flightId, pilot.getId()).map(this::dto);
    }

    /** Ends the pilot's watch on the flight; false where there was none
     *  of theirs to end. */
    public boolean unwatch(Pilot pilot, Long flightId) {
        return watches.findByFlightIdAndPilotId(flightId, pilot.getId()).map(watch -> {
            watches.delete(watch);
            return true;
        }).orElse(false);
    }

    /** Every half hour (wingtip.watch.every), the watches due a check.
     *  The first run waits one interval, so a restart does not re-brief
     *  every watch at once; a check it delays is caught by the next. */
    @Scheduled(fixedDelayString = "${wingtip.watch.every:PT30M}", initialDelayString = "${wingtip.watch.every:PT30M}")
    public void check() {
        check(Instant.now());
    }

    /**
     * Checks the watches due at {@code now}: those departing within the
     * window and not checked in the last 20 minutes, at most 50, nearest
     * departure first. Watches of flights more than two hours gone are
     * deleted first. A planner failure is logged and that watch skipped
     * for the next run -- never deleted for an outage -- and the rest go
     * on.
     *
     * @return how many were found changed
     */
    public int check(Instant now) {
        int gone = watches.deleteDepartedBefore(now.minus(AFTER_DEPARTURE));
        if (gone > 0) {
            log.info("{} flight watch(es) past departure ended", gone);
        }
        List<FlightWatch> due = watches.due(now.minus(AFTER_DEPARTURE), now.plus(BEFORE_DEPARTURE),
                now.minus(AGAIN_AFTER), PageRequest.of(0, MOST_A_RUN));
        int changed = 0;
        for (FlightWatch watch : due) {
            try {
                if (checkOne(watch, now)) {
                    changed++;
                }
            } catch (RuntimeException failed) {
                log.warn("Flight {}'s watch not checked; tried again next run", watch.getFlightId(), failed);
            }
        }
        return changed;
    }

    /** One watch's check: the briefing now against the kept one. True
     *  where something changed, and the pilot was told. */
    private boolean checkOne(FlightWatch watch, Instant now) {
        Flight flight = flights.findById(watch.getFlightId()).orElse(null);
        if (flight == null) {
            // The database cascades a deleted flight's watch; a watch read
            // between the two is simply left for it.
            return false;
        }
        String briefing = briefingOf(flight, watch.getDepartAt());
        PlannerChangesWords answer = planner.changes(flight.getDepartureIdent(), flight.getDestinationIdent(),
                flight.getStops(), watch.getBriefingJson(), briefing);
        if (answer.getUnavailable() != null) {
            // The words could not be written, so what changed is not known
            // yet: the baseline stays, and the next check diffs the same
            // one again rather than losing the change.
            log.warn("Flight {}'s changes could not be put in words: {}", watch.getFlightId(), answer.getUnavailable());
            watches.save(watch.checked(now));
            return false;
        }
        if (!Boolean.TRUE.equals(answer.getChanged())) {
            watches.save(watch.checked(now));
            return false;
        }
        watches.save(watch.changed(briefing, write(answer), now));
        // Kept before it is mailed: the app shows the change whatever the
        // mail does, and a mail that fails is logged, as the instructor
        // emails are.
        pilots.findById(watch.getPilotId()).ifPresent(pilot -> send(pilot, flight, answer));
        return true;
    }

    private String briefingOf(Flight flight, Instant departAt) {
        return planner.briefing(flight.getDepartureIdent(), flight.getDestinationIdent(), flight.getStops(),
                departAt, flight.getTotalEteMin());
    }

    private void send(Pilot pilot, Flight flight, PlannerChangesWords answer) {
        try {
            mail.send(message(pilot, flight, answer, publicBaseUrl));
        } catch (RuntimeException failed) {
            log.warn("Flight {}'s changes not emailed to {}: {}", flight.getId(), pilot.getEmail(), failed.toString());
        }
    }

    /** The email: what changed, a sentence a line, and where to read the
     *  briefing. The link opens the flight's route on the planner, as the
     *  app's own flight links do (web lib/flightLink). */
    static SimpleMailMessage message(Pilot pilot, Flight flight, PlannerChangesWords answer, String publicBaseUrl) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(pilot.getEmail());
        message.setSubject("Your flight " + flight.getDepartureIdent() + " to " + flight.getDestinationIdent() + ": what changed");
        StringBuilder body = new StringBuilder();
        for (PlannerSentence sentence : answer.getSentences() == null ? List.<PlannerSentence>of() : answer.getSentences()) {
            body.append(sentence.getText()).append('\n');
        }
        body.append("\nOpen the app to see the briefing.");
        if (!publicBaseUrl.isBlank()) {
            body.append('\n').append(publicBaseUrl).append("/app/plan?dep=").append(encode(flight.getDepartureIdent()))
                    .append("&dest=").append(encode(flight.getDestinationIdent()));
            if (!flight.getStops().isEmpty()) {
                body.append("&stops=").append(encode(String.join(",", flight.getStops())));
            }
        }
        message.setText(body.toString());
        return message;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private FlightWatchDto dto(FlightWatch watch) {
        // This app's own answer to the browser and the phones, copied out
        // of the planner's: its shape is this app's API, which outlives
        // a change to the planner's.
        PlannerChangesWords changes = read(watch);
        List<BriefingChangeDto> sentences = changes == null || changes.getSentences() == null ? List.of()
                : changes.getSentences().stream()
                        .map(c -> new BriefingChangeDto(c.getText(), c.getSources() == null ? List.<String>of() : c.getSources()))
                        .toList();
        List<BriefingSourceDto> sources = changes == null || changes.getSources() == null ? List.of()
                : changes.getSources().stream()
                        .map(s -> new BriefingSourceDto(s.getId(), s.getLabel(), s.getText()))
                        .toList();
        return new FlightWatchDto(watch.getFlightId(), watch.getDepartAt(), watch.getCheckedAt(), watch.getChangedAt(),
                sentences, sources);
    }

    private static String write(PlannerChangesWords answer) {
        try {
            return PlannerClient.JSON.writeValueAsString(answer);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("The planner's changes would not write as JSON", e);
        }
    }

    private static PlannerChangesWords read(FlightWatch watch) {
        if (watch.getChangesJson() == null) {
            return null;
        }
        try {
            // Kept as the planner wrote it, so read as the planner's: the
            // rows written before these were generated have the same fields.
            return PlannerClient.JSON.readValue(watch.getChangesJson(), PlannerChangesWords.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Flight " + watch.getFlightId() + "'s kept changes are not JSON", e);
        }
    }
}
