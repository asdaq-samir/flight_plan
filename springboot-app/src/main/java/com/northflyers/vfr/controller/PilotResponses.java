package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.PilotService;
import java.util.function.Function;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;

/**
 * The answer every pilot-scoped endpoint gives: the action's, for the
 * pilot the session belongs to, or 401 when it belongs to none. The
 * aircraft and flight controllers each carried their own copy.
 */
final class PilotResponses {

    private PilotResponses() {}

    static <T> ResponseEntity<T> withPilot(
            PilotService pilots, Authentication authentication, Function<Pilot, ResponseEntity<T>> action) {
        return pilots.current(authentication).map(action).orElseGet(() -> ResponseEntity.status(401).build());
    }
}
