package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.dto.FlightCheckpointDto;
import com.northflyers.vfr.dto.FlightDto;
import com.northflyers.vfr.dto.FlightSummaryDto;
import com.northflyers.vfr.dto.RiskAssessmentDto;
import com.northflyers.vfr.dto.SaveFlightRequest;
import com.northflyers.vfr.dto.TrackDto;
import com.northflyers.vfr.service.FlightService;
import com.northflyers.vfr.service.PilotService;
import jakarta.validation.Valid;
import java.util.List;
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

/** A pilot's own filed flights -- list, save a new one (answered with
 *  its nav log), delete. Pilot-scoped the same way {@link AircraftController}
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
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                ResponseEntity.ok(flightService.list(pilot).stream().map(FlightController::toSummaryDto).toList()));
    }

    @PostMapping
    public ResponseEntity<FlightDto> save(Authentication authentication, @Valid @RequestBody SaveFlightRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                ResponseEntity.ok(toDto(flightService.save(pilot, request))));
    }

    /** One of the pilot's flights, with its nav log: what its debrief
     *  is read against. */
    @GetMapping("/{id}")
    public ResponseEntity<FlightDto> get(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                flightService.get(pilot, id).map(f -> ResponseEntity.ok(toDto(f))).orElse(ResponseEntity.notFound().build()));
    }

    /** The flight's track, where the pilot saved one to their account. */
    @GetMapping("/{id}/track")
    public ResponseEntity<TrackDto> track(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                flightService.track(pilot, id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build()));
    }

    @PutMapping("/{id}/track")
    public ResponseEntity<Void> saveTrack(Authentication authentication, @PathVariable Long id, @Valid @RequestBody TrackDto track) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                flightService.saveTrack(pilot, id, track) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}/track")
    public ResponseEntity<Void> deleteTrack(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                flightService.deleteTrack(pilot, id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                flightService.delete(pilot, id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    private static FlightSummaryDto toSummaryDto(Flight f) {
        return new FlightSummaryDto(f.getId(), f.getDepartureIdent(), f.getDestinationIdent(), f.getStops(),
                f.getAircraft() == null ? null : f.getAircraft().getTailNumber(),
                f.getCruiseAltitudeFt(), f.getTotalDistanceNm(), f.getTotalEteMin(), f.getTotalFuelGal(),
                f.getPlannedFor(), f.getCreatedAt(), riskOf(f));
    }

    private static RiskAssessmentDto riskOf(Flight f) {
        return f.getRiskScore() == null ? null : new RiskAssessmentDto(f.getRiskScore(), f.getRiskLevel(), f.getRiskFactors());
    }

    private static FlightDto toDto(Flight f) {
        List<FlightCheckpointDto> checkpoints = f.getCheckpoints().stream()
                .map(FlightController::toCheckpointDto)
                .toList();
        return new FlightDto(f.getId(), f.getDepartureIdent(), f.getDestinationIdent(), f.getStops(),
                f.getAircraft() == null ? null : f.getAircraft().getTailNumber(),
                f.getCruiseAltitudeFt(), f.getTotalDistanceNm(), f.getTotalEteMin(), f.getTotalFuelGal(),
                f.getPlannedFor(), f.getCreatedAt(), riskOf(f), checkpoints);
    }

    private static FlightCheckpointDto toCheckpointDto(FlightCheckpoint c) {
        return new FlightCheckpointDto(c.getSequenceNo(), c.getName(), c.getCategory(), c.getLat(), c.getLon(),
                c.getAlongTrackNm(), c.getLegDistanceNm(), c.getTrueCourseDeg(), c.getMagneticHeadingDeg(),
                c.getGroundspeedKt(), c.getEteMin(), c.getFuelGal(), c.getAltitudeFt());
    }
}
