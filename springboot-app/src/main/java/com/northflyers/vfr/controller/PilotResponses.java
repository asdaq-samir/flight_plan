package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.PilotService;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;

/**
 * The answer every pilot-scoped endpoint gives: the action's, for the
 * pilot the session belongs to, or 401 when it belongs to none; and the
 * 404 of one that finds nothing of theirs. The
 * aircraft and flight controllers each carried their own copy.
 */
final class PilotResponses {

    private PilotResponses() {}

    static <T> ResponseEntity<T> withPilot(
            PilotService pilots, Authentication authentication, Function<Pilot, ResponseEntity<T>> action) {
        return pilots.current(authentication).map(action).orElseGet(() -> ResponseEntity.status(401).build());
    }

    /** The action's answer for the pilot: 200 with it, or 404 when it
     *  found nothing of theirs. */
    static <T> ResponseEntity<T> found(
            PilotService pilots, Authentication authentication, Function<Pilot, Optional<T>> action) {
        return withPilot(pilots, authentication, pilot -> ResponseEntity.of(action.apply(pilot)));
    }

    /** 204 once the action is done for the pilot, or 404 when it found
     *  nothing of theirs to do it to. */
    static ResponseEntity<Void> done(PilotService pilots, Authentication authentication, Predicate<Pilot> action) {
        return withPilot(pilots, authentication, pilot -> action.test(pilot)
                ? ResponseEntity.noContent().build()
                : ResponseEntity.notFound().build());
    }
}
