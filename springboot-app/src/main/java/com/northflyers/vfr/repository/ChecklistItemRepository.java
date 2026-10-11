package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.ChecklistItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/** An airplane's checklist lines, read and replaced whole. Scoped to the
 *  pilot by the airplane, which the service finds by pilot first. */
public interface ChecklistItemRepository extends JpaRepository<ChecklistItem, Long> {

    List<ChecklistItem> findByAircraftIdOrderBySequenceNoAsc(Long aircraftId);

    @Modifying
    @Query("DELETE FROM ChecklistItem i WHERE i.aircraft.id = :aircraftId")
    void deleteByAircraftId(Long aircraftId);
}
