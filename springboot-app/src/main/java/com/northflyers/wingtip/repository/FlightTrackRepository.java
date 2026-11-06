package com.northflyers.wingtip.repository;

import com.northflyers.wingtip.domain.FlightTrack;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FlightTrackRepository extends JpaRepository<FlightTrack, Long> {
}
