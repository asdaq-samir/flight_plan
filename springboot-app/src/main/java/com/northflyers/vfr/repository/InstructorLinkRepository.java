package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.InstructorLink;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Persistence for {@link InstructorLink}. */
public interface InstructorLinkRepository extends JpaRepository<InstructorLink, Long> {

    /** A student's instructors, asked and taken, oldest first. */
    List<InstructorLink> findByStudentIdOrderByAskedAt(Long studentId);

    /** An instructor's students, oldest first. */
    List<InstructorLink> findByInstructorIdOrderByAcceptedAt(Long instructorId);

    /** Asks for an address not yet taken, whatever its case. */
    @Query("SELECT l FROM InstructorLink l WHERE l.instructor IS NULL AND lower(l.email) = lower(:email) ORDER BY l.askedAt")
    List<InstructorLink> findOpenFor(@Param("email") String email);

    Optional<InstructorLink> findByStudentIdAndInstructorId(Long studentId, Long instructorId);

    boolean existsByStudentIdAndEmailIgnoreCase(Long studentId, String email);

    long countByStudentIdAndAskedAtAfter(Long studentId, Instant after);
}
