package com.northflyers.wingtip.controller;

import com.northflyers.wingtip.dto.FlightWatchDto;
import com.northflyers.wingtip.dto.WatchFlightRequest;
import com.northflyers.wingtip.service.FlightWatchService;
import com.northflyers.wingtip.service.PilotService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** A pilot's watch on one of their saved flights -- start it, read what
 *  changed, end it. Pilot-scoped the same way {@link FlightController}
 *  is: another pilot's flight is not found, never refused as existing. */
@RestController
@RequestMapping("/api/flights/{id}/watch")
public class FlightWatchController {

    private final FlightWatchService watches;
    private final PilotService pilots;

    public FlightWatchController(FlightWatchService watches, PilotService pilots) {
        this.watches = watches;
        this.pilots = pilots;
    }

    /** Watches the flight up to its departure, briefing it now as the
     *  baseline; the watch, with no changes yet. */
    @PostMapping
    public ResponseEntity<FlightWatchDto> watch(Authentication authentication, @PathVariable Long id,
                                                @Valid @RequestBody WatchFlightRequest request) {
        return PilotResponses.found(pilots, authentication, pilot -> watches.watch(pilot, id, request.departAt()));
    }

    /** The watch and the latest changes, for the app to show. */
    @GetMapping
    public ResponseEntity<FlightWatchDto> get(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.found(pilots, authentication, pilot -> watches.watchOf(pilot, id));
    }

    @DeleteMapping
    public ResponseEntity<Void> unwatch(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.done(pilots, authentication, pilot -> watches.unwatch(pilot, id));
    }
}
