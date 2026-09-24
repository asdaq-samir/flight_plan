package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Flight;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link Flight}, scoped to the pilot who filed it. */
public interface FlightRepository extends JpaRepository<Flight, Long> {

    /** Fetches {@code aircraft} eagerly -- {@link com.northflyers.vfr.controller.FlightController}
     *  reads every flight's tail number to build its summary list, which
     *  otherwise issues one extra query per flight for a LAZY association. */
    @EntityGraph(attributePaths = "aircraft")
    List<Flight> findByPilotIdOrderByCreatedAtDesc(Long pilotId);

    /** Scoped by pilot for the same reason as {@code AircraftRepository}:
     *  a flight is private to the person who planned it. Fetches
     *  {@code aircraft} with it: the controller reads its tail number
     *  after the transaction has closed (open-in-view is off), and the
     *  LAZY association then threw -- a 500 for every flight filed with
     *  one of the pilot's aeroplanes. */
    @EntityGraph(attributePaths = "aircraft")
    Optional<Flight> findByIdAndPilotId(Long id, Long pilotId);
}
