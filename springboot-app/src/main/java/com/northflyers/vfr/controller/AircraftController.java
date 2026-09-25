package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.AircraftDto;
import com.northflyers.vfr.dto.AircraftRequest;
import com.northflyers.vfr.service.AircraftService;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/aircraft")
public class AircraftController {

    private final AircraftService aircraftService;
    private final PilotService pilots;
    private final FlightApiMapper mapper;

    public AircraftController(AircraftService aircraftService, PilotService pilots, FlightApiMapper mapper) {
        this.aircraftService = aircraftService;
        this.pilots = pilots;
        this.mapper = mapper;
    }

    @GetMapping
    public ResponseEntity<List<AircraftDto>> list(Authentication authentication) {
        return withPilot(authentication, pilot ->
                ResponseEntity.ok(aircraftService.list(pilot).stream().map(mapper::toDto).toList()));
    }

    @PostMapping
    public ResponseEntity<AircraftDto> add(Authentication authentication, @Valid @RequestBody AircraftRequest request) {
        return withPilot(authentication, pilot -> ResponseEntity.ok(mapper.toDto(aircraftService.add(
                pilot, request.tailNumber(), request.typeDesignator(), request.cruiseTasKt(), request.fuelBurnGph(),
                request.usableFuelGal()))));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AircraftDto> update(
            Authentication authentication, @PathVariable Long id, @Valid @RequestBody AircraftRequest request) {
        return withPilot(authentication, pilot -> aircraftService
                .update(pilot, id, request.tailNumber(), request.typeDesignator(), request.cruiseTasKt(), request.fuelBurnGph(),
                        request.usableFuelGal())
                .map(mapper::toDto)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(Authentication authentication, @PathVariable Long id) {
        return withPilot(authentication, pilot ->
                aircraftService.delete(pilot, id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    private <T> ResponseEntity<T> withPilot(Authentication authentication, Function<Pilot, ResponseEntity<T>> action) {
        return pilots.current(authentication).map(action).orElseGet(() -> ResponseEntity.status(401).build());
    }
}
