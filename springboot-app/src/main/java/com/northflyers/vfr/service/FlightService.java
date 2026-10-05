package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.FlightCheckpoint;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.SaveFlightCheckpointRequest;
import com.northflyers.vfr.dto.SaveFlightRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.northflyers.vfr.domain.FlightTrack;
import com.northflyers.vfr.dto.TrackDto;
import com.northflyers.vfr.dto.TrackPointDto;
import com.northflyers.vfr.repository.AircraftRepository;
import com.northflyers.vfr.repository.FlightRepository;
import com.northflyers.vfr.repository.FlightTrackRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** A pilot's own flights -- their use of a route, the aircraft they
 *  flew it in, and the nav log they filed. Scoped by pilot the same
 *  way {@link AircraftService} is. */
@Service
public class FlightService {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<List<TrackPointDto>> POINTS = new TypeReference<>() { };

    private final FlightRepository flights;
    private final AircraftRepository aircraft;
    private final FlightTrackRepository tracks;

    public FlightService(FlightRepository flights, AircraftRepository aircraft, FlightTrackRepository tracks) {
        this.flights = flights;
        this.aircraft = aircraft;
        this.tracks = tracks;
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

        Flight flight = new Flight(pilot, flownIn, request.departureIdent(), request.destinationIdent())
                .withStops(request.stops() == null ? null : request.stops().stream().map(String::toUpperCase).toList());
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
        if (request.risk() != null) {
            flight.assessed(request.risk().score(), request.risk().level(), request.risk().factors());
        }
        return flights.save(flight);
    }

    /** The flight's saved track, where it is this pilot's flight and has
     *  one. */
    public Optional<TrackDto> track(Pilot pilot, Long id) {
        return get(pilot, id).flatMap(f -> tracks.findById(f.getId())).map(t -> {
            try {
                return new TrackDto(t.getSource(), JSON.readValue(t.getPoints(), POINTS));
            } catch (JsonProcessingException e) {
                throw new IllegalStateException("Flight " + id + "'s saved track is not JSON", e);
            }
        });
    }

    /** Saves a track with this pilot's flight, replacing one saved before;
     *  false where the flight is not theirs. */
    @Transactional
    public boolean saveTrack(Pilot pilot, Long id, TrackDto track) {
        return get(pilot, id).map(f -> {
            String points;
            try {
                points = JSON.writeValueAsString(track.points());
            } catch (JsonProcessingException e) {
                throw new IllegalStateException("A track's points would not write as JSON", e);
            }
            tracks.findById(f.getId()).ifPresentOrElse(
                    saved -> saved.replace(track.source(), points, track.points().size()),
                    () -> tracks.save(new FlightTrack(f.getId(), track.source(), points, track.points().size())));
            return true;
        }).orElse(false);
    }

    /** Takes a flight's saved track out of the account; false where the
     *  flight is not theirs. */
    @Transactional
    public boolean deleteTrack(Pilot pilot, Long id) {
        return get(pilot, id).map(f -> {
            tracks.deleteById(f.getId());
            return true;
        }).orElse(false);
    }

    public boolean delete(Pilot pilot, Long id) {
        return get(pilot, id).map(f -> {
            flights.delete(f);
            return true;
        }).orElse(false);
    }
}
