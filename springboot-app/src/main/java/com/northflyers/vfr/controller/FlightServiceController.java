package com.northflyers.vfr.controller;

import com.northflyers.vfr.dto.FlightPlanFiled;
import com.northflyers.vfr.dto.FlightPlanFilingRequest;
import com.northflyers.vfr.dto.FlightServiceStatus;
import com.northflyers.vfr.flightservice.FlightServiceGateway;
import com.northflyers.vfr.service.PilotService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Filing a flight plan with Flight Service from the app, and its standard
 * briefing (FlightServiceGateway) -- signed in, in the pilot's name. With
 * no provider connected, the status says so and each ask is a 503 that
 * sends the pilot to Flight Service itself.
 */
@RestController
@RequestMapping("/api/flight-service")
public class FlightServiceController {

    private final FlightServiceGateway flightService;
    private final PilotService pilots;

    public FlightServiceController(FlightServiceGateway flightService, PilotService pilots) {
        this.flightService = flightService;
        this.pilots = pilots;
    }

    @GetMapping
    public FlightServiceStatus status() {
        return new FlightServiceStatus(flightService.connected(), flightService.provider());
    }

    @PostMapping("/flight-plans")
    public ResponseEntity<FlightPlanFiled> file(Authentication authentication, @Valid @RequestBody FlightPlanFilingRequest plan) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                ResponseEntity.status(HttpStatus.CREATED).body(new FlightPlanFiled(flightService.file(pilot, plan))));
    }

    @PostMapping("/briefings")
    public ResponseEntity<String> brief(Authentication authentication, @Valid @RequestBody FlightPlanFilingRequest plan) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> ResponseEntity.ok(flightService.brief(pilot, plan)));
    }
}
