package com.northflyers.wingtip.repository;

import com.northflyers.wingtip.domain.ApproachLesson;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence for {@link ApproachLesson}. */
public interface ApproachLessonRepository extends JpaRepository<ApproachLesson, Long> {

    /** A student's, from all their instructors, newest first. */
    List<ApproachLesson> findByStudentIdOrderByCreatedAtDesc(Long studentId);

    /** Those one instructor set one student, newest first. */
    List<ApproachLesson> findByStudentIdAndInstructorIdOrderByCreatedAtDesc(Long studentId, Long instructorId);

    /** What goes with a link between the two when either ends it. */
    void deleteByStudentIdAndInstructorId(Long studentId, Long instructorId);
}
