package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.FlightCheckpointDto;
import com.northflyers.vfr.dto.FlightDto;
import com.northflyers.vfr.dto.FlightSummaryDto;
import com.northflyers.vfr.dto.SaveFlightRequest;
import com.northflyers.vfr.service.FlightService;
import com.northflyers.vfr.service.PilotService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.function.Function;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** A pilot's own filed flights -- list, view one (with its nav log),
 *  save a new one, delete. Pilot-scoped the same way {@link AircraftController}
 *  is, for the same reason. */
@RestController
@RequestMapping("/api/flights")
public class FlightController {

    private final FlightService flightService;
    private final PilotService pilots;
    private final FlightApiMapper mapper;

    public FlightController(FlightService flightService, PilotService pilots, FlightApiMapper mapper) {
        this.flightService = flightService;
        this.pilots = pilots;
        this.mapper = mapper;
    }

    @GetMapping
    public ResponseEntity<List<FlightSummaryDto>> list(Authentication authentication) {
        return withPilot(authentication, pilot ->
                ResponseEntity.ok(flightService.list(pilot).stream().map(mapper::toSummaryDto).toList()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<FlightDto> get(Authentication authentication, @PathVariable Long id) {
        return withPilot(authentication, pilot -> flightService.get(pilot, id)
                .map(f -> ResponseEntity.ok(mapper.toDto(f)))
                .orElse(ResponseEntity.notFound().build()));
    }

    @PostMapping
    public ResponseEntity<FlightDto> save(Authentication authentication, @Valid @RequestBody SaveFlightRequest request) {
        return withPilot(authentication, pilot -> ResponseEntity.ok(mapper.toDto(flightService.save(pilot, request))));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(Authentication authentication, @PathVariable Long id) {
        return withPilot(authentication, pilot ->
                flightService.delete(pilot, id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    private <T> ResponseEntity<T> withPilot(Authentication authentication, Function<Pilot, ResponseEntity<T>> action) {
        return pilots.current(authentication).map(action).orElseGet(() -> ResponseEntity.status(401).build());
    }

}
