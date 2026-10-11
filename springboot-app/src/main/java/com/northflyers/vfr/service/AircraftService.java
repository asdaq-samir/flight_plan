package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.VorCheck;
import com.northflyers.vfr.dto.InspectionsRequest;
import com.northflyers.vfr.repository.AircraftRepository;
import java.time.LocalDate;
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

    public Aircraft add(Pilot pilot, String tailNumber, String typeDesignator, double cruiseTasKt, double fuelBurnGph,
                        Double cruisePowerPct, Double climbTasKt, Double climbFuelBurnGph, Double usableFuelGal) {
        return aircraft.save(new Aircraft(pilot, tailNumber, typeDesignator, cruiseTasKt, fuelBurnGph, cruisePowerPct,
                climbTasKt, climbFuelBurnGph, usableFuelGal));
    }

    /** Empty when no such aircraft exists for this pilot -- not
     *  distinguished from "belongs to someone else," which reads
     *  identically to a caller guessing ids on purpose. */
    public Optional<Aircraft> update(Pilot pilot, Long id, String tailNumber, String typeDesignator,
                                     double cruiseTasKt, double fuelBurnGph, Double cruisePowerPct, Double climbTasKt,
                                     Double climbFuelBurnGph, Double usableFuelGal) {
        return get(pilot, id).map(a -> aircraft.save(a.update(tailNumber, typeDesignator, cruiseTasKt, fuelBurnGph,
                cruisePowerPct, climbTasKt, climbFuelBurnGph, usableFuelGal)));
    }

    /** The airplane's VOR check for IFR, as the pilot records it (14 CFR 91.171(d)). */
    public Optional<Aircraft> recordVorCheck(Pilot pilot, Long id, LocalDate on, VorCheck kind, String place, double errorDeg) {
        return get(pilot, id).map(a -> aircraft.save(a.recordVorCheck(on, kind, place == null || place.isBlank() ? null : place.strip(),
                errorDeg)));
    }

    /** The airplane's inspections and tests, as its owner records them. */
    public Optional<Aircraft> recordInspections(Pilot pilot, Long id, InspectionsRequest r) {
        return get(pilot, id).map(a -> aircraft.save(a.recordInspections(r.annualOn(), r.hundredHourAtHours(), r.hoursNow(),
                r.staticCheckOn(), r.transponderCheckOn(), r.eltInspectedOn(), r.eltBatteryDueOn())));
    }

    /** @return true if an aircraft was actually deleted */
    public boolean delete(Pilot pilot, Long id) {
        return get(pilot, id).map(a -> {
            aircraft.delete(a);
            return true;
        }).orElse(false);
    }
}
