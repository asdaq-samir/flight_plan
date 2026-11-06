package com.northflyers.wingtip.repository;

import com.northflyers.wingtip.domain.FlightWatch;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

/** Persistence for {@link FlightWatch}, scoped to the pilot whose flight
 *  it is, as {@link FlightRepository} is. */
public interface FlightWatchRepository extends JpaRepository<FlightWatch, Long> {

    /** Scoped by pilot for the same reason as {@code FlightRepository}: a
     *  watch is private to the pilot who asked for it. */
    Optional<FlightWatch> findByFlightIdAndPilotId(Long flightId, Long pilotId);

    /** The watches due a check: departing within the window, and not
     *  checked since {@code notSince}, nearest departure first; as many
     *  as the page asks for. */
    @Query("SELECT w FROM FlightWatch w WHERE w.departAt BETWEEN :since AND :until"
            + " AND (w.checkedAt IS NULL OR w.checkedAt < :notSince) ORDER BY w.departAt")
    List<FlightWatch> due(@Param("since") Instant since, @Param("until") Instant until,
                          @Param("notSince") Instant notSince, Pageable page);

    /** Watches of flights that departed before {@code before}: a flight
     *  gone cannot be re-briefed, and the row would only grow the table. */
    @Modifying
    @Transactional
    @Query("DELETE FROM FlightWatch w WHERE w.departAt < :before")
    int deleteDepartedBefore(@Param("before") Instant before);
}
