package com.northflyers.vfr.repository;

import com.northflyers.vfr.domain.CrossCountryReview;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link CrossCountryReview}. */
public interface CrossCountryReviewRepository extends JpaRepository<CrossCountryReview, Long> {

    /** A student's, newest first. */
    List<CrossCountryReview> findByStudentIdOrderByAskedAtDesc(Long studentId);

    /** The ones put to an instructor and not yet answered, oldest first. */
    List<CrossCountryReview> findByInstructorIdAndAnsweredAtIsNullOrderByAskedAt(Long instructorId);

    /** Between one student and one instructor, newest first. */
    List<CrossCountryReview> findByStudentIdAndInstructorIdOrderByAskedAtDesc(Long studentId, Long instructorId);
}
