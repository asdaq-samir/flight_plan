package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.PilotDto;
import com.northflyers.vfr.service.PilotService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Who the caller is. The endpoint a front end asks on load to decide
 * whether to show a sign-in button or a pilot's own flights.
 */
@RestController
@RequestMapping("/api/me")
public class PilotController {

    private final PilotService pilots;

    public PilotController(PilotService pilots) {
        this.pilots = pilots;
    }

    @Operation(summary = "The signed-in pilot",
            description = "Creates the pilot record on first sign-in. 401 when no session exists.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "The signed-in pilot"),
        @ApiResponse(responseCode = "401", description = "No session")
    })
    @GetMapping
    public ResponseEntity<PilotDto> me(Authentication authentication) {
        return pilots.current(authentication)
                .map(PilotController::toDto)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(401).build());
    }

    private static PilotDto toDto(Pilot pilot) {
        return new PilotDto(pilot.getId(), pilot.getEmail(), pilot.getDisplayName(), pilot.getRole().isDeveloper());
    }
}
