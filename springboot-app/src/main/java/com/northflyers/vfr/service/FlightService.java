package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.SaveFlightCheckpointRequest;
import com.northflyers.vfr.dto.SaveFlightRequest;
import com.northflyers.vfr.repository.AircraftRepository;
import com.northflyers.vfr.repository.FlightRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** A pilot's own flights -- their use of a route, the aircraft they
 *  flew it in, and the nav log they filed. Scoped by pilot the same
 *  way {@link AircraftService} is. */
@Service
public class FlightService {

    private final FlightRepository flights;
    private final AircraftRepository aircraft;

    public FlightService(FlightRepository flights, AircraftRepository aircraft) {
        this.flights = flights;
        this.aircraft = aircraft;
    }

    public List<Flight> list(Pilot pilot) {
        return flights.findByPilotIdOrderByCreatedAtDesc(pilot.getId());
    }

    public Optional<Flight> get(Pilot pilot, Long id) {
        return flights.findByIdAndPilotId(id, pilot.getId());
    }

    /** Files a new flight and its nav log. The referenced aircraft (if
     *  any) must belong to this pilot -- looked up the same
     *  pilot-scoped way {@link #get} is. Naming an id that doesn't
     *  resolve throws rather than silently filing with no aircraft:
     *  a request naming an id explicitly is asserting it should
     *  attach, not offering a hint that can be dropped. */
    @Transactional
    public Flight save(Pilot pilot, SaveFlightRequest request) {
        Aircraft flownIn = request.aircraftId() == null
                ? null
                : aircraft.findByIdAndPilotId(request.aircraftId(), pilot.getId())
                        .orElseThrow(() -> new NoSuchAircraftException(request.aircraftId()));

        Flight flight = new Flight(pilot, flownIn, request.departureIdent(), request.destinationIdent());
        List<SaveFlightCheckpointRequest> requestedCheckpoints =
                request.checkpoints() == null ? List.of() : request.checkpoints();
        List<FlightCheckpoint> navLog = requestedCheckpoints.stream()
                .map(c -> new FlightCheckpoint(c.sequenceNo(), c.name(), c.category(), c.lat(), c.lon(), c.alongTrackNm())
                        .withLeg(c.legDistanceNm(), c.trueCourseDeg(), c.magneticHeadingDeg(),
                                c.groundspeedKt(), c.eteMin(), c.fuelGal())
                        .atAltitude(c.altitudeFt()))
                .toList();
        flight.fileNavLog(navLog, request.cruiseAltitudeFt(), request.totalDistanceNm(),
                request.totalEteMin(), request.totalFuelGal());
        if (request.plannedFor() != null) {
            flight.plannedFor(request.plannedFor());
        }
        return flights.save(flight);
    }

    public boolean delete(Pilot pilot, Long id) {
        return get(pilot, id).map(f -> {
            flights.delete(f);
            return true;
        }).orElse(false);
    }
}
