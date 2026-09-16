package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
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

    public FlightController(FlightService flightService, PilotService pilots) {
        this.flightService = flightService;
        this.pilots = pilots;
    }

    @GetMapping
    public ResponseEntity<List<FlightSummaryDto>> list(Authentication authentication) {
        return withPilot(authentication, pilot ->
                ResponseEntity.ok(flightService.list(pilot).stream().map(FlightController::toSummaryDto).toList()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<FlightDto> get(Authentication authentication, @PathVariable Long id) {
        return withPilot(authentication, pilot -> flightService.get(pilot, id)
                .map(f -> ResponseEntity.ok(toDto(f)))
                .orElse(ResponseEntity.notFound().build()));
    }

    @PostMapping
    public ResponseEntity<FlightDto> save(Authentication authentication, @Valid @RequestBody SaveFlightRequest request) {
        return withPilot(authentication, pilot -> ResponseEntity.ok(toDto(flightService.save(pilot, request))));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(Authentication authentication, @PathVariable Long id) {
        return withPilot(authentication, pilot ->
                flightService.delete(pilot, id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    private <T> ResponseEntity<T> withPilot(Authentication authentication, Function<Pilot, ResponseEntity<T>> action) {
        return pilots.current(authentication).map(action).orElseGet(() -> ResponseEntity.status(401).build());
    }

    private static FlightSummaryDto toSummaryDto(Flight f) {
        return new FlightSummaryDto(f.getId(), f.getDepartureIdent(), f.getDestinationIdent(),
                f.getAircraft() == null ? null : f.getAircraft().getTailNumber(),
                f.getCruiseAltitudeFt(), f.getTotalDistanceNm(), f.getTotalEteMin(), f.getTotalFuelGal(),
                f.getPlannedFor(), f.getCreatedAt());
    }

    private static FlightDto toDto(Flight f) {
        List<FlightCheckpointDto> checkpoints = f.getCheckpoints().stream()
                .map(FlightController::toCheckpointDto)
                .toList();
        return new FlightDto(f.getId(), f.getDepartureIdent(), f.getDestinationIdent(),
                f.getAircraft() == null ? null : f.getAircraft().getTailNumber(),
                f.getCruiseAltitudeFt(), f.getTotalDistanceNm(), f.getTotalEteMin(), f.getTotalFuelGal(),
                f.getPlannedFor(), f.getCreatedAt(), checkpoints);
    }

    private static FlightCheckpointDto toCheckpointDto(FlightCheckpoint c) {
        return new FlightCheckpointDto(c.getSequenceNo(), c.getName(), c.getCategory(), c.getLat(), c.getLon(),
                c.getAlongTrackNm(), c.getLegDistanceNm(), c.getTrueCourseDeg(), c.getMagneticHeadingDeg(),
                c.getGroundspeedKt(), c.getEteMin(), c.getFuelGal());
    }
}
