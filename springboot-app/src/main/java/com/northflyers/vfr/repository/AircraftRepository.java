package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Aircraft;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link Aircraft}, scoped to its owner. */
public interface AircraftRepository extends JpaRepository<Aircraft, Long> {

    List<Aircraft> findByPilotIdOrderByTailNumberAsc(Long pilotId);

    /**
     * Scoped by pilot rather than by id alone, so one pilot cannot fetch
     * another's aeroplane by guessing a number.
     */
    Optional<Aircraft> findByIdAndPilotId(Long id, Long pilotId);
}
