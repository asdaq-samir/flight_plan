package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.Endorsement;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link Endorsement}, one per pilot and code. */
public interface EndorsementRepository extends JpaRepository<Endorsement, Endorsement.Key> {

    List<Endorsement> findByKeyPilotIdOrderByKeyCode(Long pilotId);
}
