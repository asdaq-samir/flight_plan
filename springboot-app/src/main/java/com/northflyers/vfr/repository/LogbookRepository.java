package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.LogbookEntry;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link LogbookEntry}, scoped to its pilot. */
public interface LogbookRepository extends JpaRepository<LogbookEntry, Long> {

    /** The newest first, as a logbook is read back. */
    List<LogbookEntry> findByPilotIdOrderByFlownOnDescIdDesc(Long pilotId);

    /** Scoped by pilot, so one pilot cannot reach another's by its id. */
    Optional<LogbookEntry> findByIdAndPilotId(Long id, Long pilotId);
}
