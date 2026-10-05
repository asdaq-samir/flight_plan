package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.FlightTrack;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FlightTrackRepository extends JpaRepository<FlightTrack, Long> {
}
