package com.northflyers.wingtip.dto;

import java.util.List;
import org.springframework.lang.Nullable;

/**
 * A student's way to the checkride, beside the logbook: 61.109's
 * experience as the logbook shows it, the ACS codes on their knowledge
 * test report, the endorsements they recorded from paper and those
 * signed in the app, the endorsements there are, their name as their
 * certificate gives it, their instructors, their solo cross-countries
 * put to them, and the approaches their instructors set them to learn.
 */
public record TrainingDto(
        List<ExperienceItemDto> experience,
        List<String> knowledgeTestCodes,
        List<EndorsementDto> endorsements,
        List<SignedEndorsementDto> signed,
        List<EndorsementKindDto> kinds,
        @Nullable String fullName,
        List<InstructorLinkDto> instructors,
        List<CrossCountryReviewDto> reviews,
        List<ApproachLessonDto> lessons) {
}
