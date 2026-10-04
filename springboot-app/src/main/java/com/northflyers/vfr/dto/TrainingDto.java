package com.northflyers.vfr.dto;

import java.util.List;

/**
 * A student's way to the checkride, beside the logbook: 61.109's
 * experience as the logbook shows it, the ACS codes on their knowledge
 * test report, and the endorsements they hold.
 */
public record TrainingDto(List<ExperienceItemDto> experience, List<String> knowledgeTestCodes, List<EndorsementDto> endorsements) {
}
