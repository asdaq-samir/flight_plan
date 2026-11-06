package com.northflyers.wingtip.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** One thing that changed in a watched flight's briefing, in the
 *  planner's words, and the ids of the reports it was read from
 *  ("metar:KDLH"), which {@link BriefingSourceDto} lists. The shape the
 *  planner's /api/words/changes writes a sentence in, carried as it is. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record BriefingChangeDto(String text, List<String> sources) {
}
