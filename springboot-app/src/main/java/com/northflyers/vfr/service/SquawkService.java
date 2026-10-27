package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.Squawk;
import com.northflyers.vfr.dto.SquawkDto;
import com.northflyers.vfr.dto.SquawkRequest;
import com.northflyers.vfr.repository.SquawkRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

/** A pilot's airplane's squawks: listed newest first, added, changed (or
 *  fixed) and taken out; empty where the airplane is not this pilot's. */
@Service
public class SquawkService {

    private final AircraftService aircraft;
    private final SquawkRepository squawks;

    public SquawkService(AircraftService aircraft, SquawkRepository squawks) {
        this.aircraft = aircraft;
        this.squawks = squawks;
    }

    public Optional<List<SquawkDto>> list(Pilot pilot, Long aircraftId) {
        return aircraft.get(pilot, aircraftId)
                .map(a -> squawks.findByAircraftIdOrderByReportedOnDescIdDesc(a.getId()).stream().map(SquawkService::toDto).toList());
    }

    /** The airplane's open squawks, for its risk on the day. */
    public List<SquawkDto> open(Long aircraftId) {
        return squawks.findByAircraftIdAndFixedOnIsNullOrderByReportedOnDescIdDesc(aircraftId).stream().map(SquawkService::toDto).toList();
    }

    public Optional<SquawkDto> add(Pilot pilot, Long aircraftId, SquawkRequest r) {
        return aircraft.get(pilot, aircraftId).map(a -> toDto(squawks.save(fill(new Squawk(a), r))));
    }

    public Optional<SquawkDto> update(Pilot pilot, Long aircraftId, Long id, SquawkRequest r) {
        return aircraft.get(pilot, aircraftId)
                .flatMap(a -> squawks.findByIdAndAircraftId(id, a.getId()))
                .map(s -> toDto(squawks.save(fill(s, r))));
    }

    /** @return true if a squawk was actually deleted */
    public boolean delete(Pilot pilot, Long aircraftId, Long id) {
        return aircraft.get(pilot, aircraftId)
                .flatMap(a -> squawks.findByIdAndAircraftId(id, a.getId()))
                .map(s -> {
                    squawks.delete(s);
                    return true;
                }).orElse(false);
    }

    private static Squawk fill(Squawk s, SquawkRequest r) {
        return s.set(r.reportedOn(), r.text().strip(), r.inoperative(), r.deferredFor(), r.fixedOn(), Typed.text(r.fixNote()));
    }

    static SquawkDto toDto(Squawk s) {
        return new SquawkDto(s.getId(), s.getReportedOn(), s.getText(), s.isInoperative(), s.getDeferredFor(), s.getFixedOn(),
                s.getFixNote());
    }
}
