package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.PilotService;
import java.util.function.Function;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;

/** Shared HTTP boundary for pilot-scoped controllers. */
final class PilotResponses {
    private PilotResponses() {}

    static <T> ResponseEntity<T> withPilot(
            PilotService pilots, Authentication authentication, Function<Pilot, ResponseEntity<T>> action) {
        return pilots.current(authentication).map(action).orElseGet(() -> ResponseEntity.status(401).build());
    }
}
