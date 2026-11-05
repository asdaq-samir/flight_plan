package com.northflyers.wingtip.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** A report a change was read from: its id as the sentences name it
 *  ("metar:KDLH"), its label ("METAR KDLH 1753Z") and its raw text as
 *  sent. The shape the planner's /api/words/changes writes a source in,
 *  carried as it is. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record BriefingSourceDto(String id, String label, String text) {
}
