package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.ErrorResponse;
import com.northflyers.vfr.dto.PilotDto;
import com.northflyers.vfr.service.AccountService;
import com.northflyers.vfr.service.AccountService.AccountNotDeletedException;
import com.northflyers.vfr.service.PilotService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Who the caller is -- the endpoint a front end asks on load to decide
 * whether to show a sign-in button or a pilot's own flights -- and the
 * deletion of their account.
 */
@RestController
@RequestMapping("/api/me")
public class PilotController {

    private static final Logger log = LoggerFactory.getLogger(PilotController.class);

    private final PilotService pilots;
    private final AccountService accounts;

    public PilotController(PilotService pilots, AccountService accounts) {
        this.pilots = pilots;
        this.accounts = accounts;
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

    @Operation(summary = "Delete the signed-in pilot's account",
            description = "The pilot and everything that was theirs -- aircraft, flights with their nav logs and "
                    + "tracks, logbook, endorsements, their own checkpoint notes, the sign-in links sent to them -- "
                    + "and every session they hold. Nothing is deleted when the planner cannot take the notes (502).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Deleted, and signed out"),
        @ApiResponse(responseCode = "401", description = "No session"),
        @ApiResponse(responseCode = "502", description = "Nothing deleted: the planner could not take the notes")
    })
    @DeleteMapping
    public ResponseEntity<?> delete(Authentication authentication, HttpServletRequest request,
            HttpServletResponse response) {
        Optional<Pilot> pilot = pilots.current(authentication);
        if (pilot.isEmpty()) {
            return ResponseEntity.status(401).build();
        }
        try {
            accounts.delete(pilot.get());
        } catch (AccountNotDeletedException failed) {
            log.warn("account {} not deleted: {}", pilot.get().getId(), failed.getMessage());
            return ResponseEntity.status(502).body(new ErrorResponse(
                    "Your account was not deleted: the planner did not answer. Nothing was removed; try again shortly."));
        }
        new SecurityContextLogoutHandler().logout(request, response, authentication);
        return ResponseEntity.noContent().build();
    }

    private static PilotDto toDto(Pilot pilot) {
        return new PilotDto(pilot.getId(), pilot.getEmail(), pilot.getDisplayName(), pilot.getRole().isDeveloper());
    }
}
