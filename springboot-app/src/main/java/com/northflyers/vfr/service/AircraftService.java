package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.AircraftRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

/** A pilot's own aeroplanes -- CRUD, all of it scoped by pilot id at
 *  the repository layer ({@link AircraftRepository#findByIdAndPilotId})
 *  so one pilot can never read or edit another's by guessing an id. */
@Service
public class AircraftService {

    private final AircraftRepository aircraft;

    public AircraftService(AircraftRepository aircraft) {
        this.aircraft = aircraft;
    }

    public List<Aircraft> list(Pilot pilot) {
        return aircraft.findByPilotIdOrderByTailNumberAsc(pilot.getId());
    }

    public Optional<Aircraft> get(Pilot pilot, Long id) {
        return aircraft.findByIdAndPilotId(id, pilot.getId());
    }

    public Aircraft add(Pilot pilot, String tailNumber, String typeDesignator, double cruiseTasKt, double fuelBurnGph) {
        return aircraft.save(new Aircraft(pilot, tailNumber, typeDesignator, cruiseTasKt, fuelBurnGph));
    }

    /** Empty when no such aircraft exists for this pilot -- not
     *  distinguished from "belongs to someone else," which reads
     *  identically to a caller guessing ids on purpose. */
    public Optional<Aircraft> update(Pilot pilot, Long id, String tailNumber, String typeDesignator,
                                     double cruiseTasKt, double fuelBurnGph) {
        return get(pilot, id).map(a -> aircraft.save(a.update(tailNumber, typeDesignator, cruiseTasKt, fuelBurnGph)));
    }

    /** @return true if an aircraft was actually deleted */
    public boolean delete(Pilot pilot, Long id) {
        return get(pilot, id).map(a -> {
            aircraft.delete(a);
            return true;
        }).orElse(false);
    }
}
