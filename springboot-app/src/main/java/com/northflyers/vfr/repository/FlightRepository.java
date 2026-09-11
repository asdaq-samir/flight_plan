package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Flight;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link Flight}, scoped to the pilot who filed it. */
public interface FlightRepository extends JpaRepository<Flight, Long> {

    List<Flight> findByPilotIdOrderByCreatedAtDesc(Long pilotId);

    /** Scoped by pilot for the same reason as {@code AircraftRepository}:
     *  a flight is private to the person who planned it. */
    Optional<Flight> findByIdAndPilotId(Long id, Long pilotId);
}
