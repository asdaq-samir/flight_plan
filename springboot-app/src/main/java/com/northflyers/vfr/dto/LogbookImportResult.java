package com.northflyers.vfr.dto;

/** What an import added, and how many it left out as already in the
 *  logbook: the same day, airplane, route and time. */
public record LogbookImportResult(int added, int duplicates) {
}
