package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Squawk;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** An airplane's squawks, scoped to the airplane, which the service finds
 *  by its pilot first. */
public interface SquawkRepository extends JpaRepository<Squawk, Long> {

    List<Squawk> findByAircraftIdOrderByReportedOnDescIdDesc(Long aircraftId);

    List<Squawk> findByAircraftIdAndFixedOnIsNullOrderByReportedOnDescIdDesc(Long aircraftId);

    Optional<Squawk> findByIdAndAircraftId(Long id, Long aircraftId);
}
