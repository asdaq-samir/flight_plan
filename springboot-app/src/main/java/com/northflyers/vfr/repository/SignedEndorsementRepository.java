package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.SignedEndorsement;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link SignedEndorsement}. */
public interface SignedEndorsementRepository extends JpaRepository<SignedEndorsement, Long> {

    /** A student's, newest first. */
    List<SignedEndorsement> findByStudentIdOrderBySignedAtDesc(Long studentId);

    /** What an instructor signed since a moment, newest first: their
     *  record (14 CFR 61.189(b)). */
    List<SignedEndorsement> findByInstructorIdAndSignedAtAfterOrderBySignedAtDesc(Long instructorId, Instant after);
}
