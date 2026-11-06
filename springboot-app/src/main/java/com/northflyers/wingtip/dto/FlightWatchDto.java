package com.northflyers.wingtip.dto;

import java.time.Instant;
import java.util.List;
import org.springframework.lang.Nullable;

/** A watched flight as the app reads it (GET and POST
 *  /api/flights/{id}/watch): when it departs, when the watch last
 *  checked and last found a change, and the latest changes with the
 *  reports they came from -- both empty until something changed. */
public record FlightWatchDto(
        Long flightId,
        Instant departAt,
        @Nullable Instant checkedAt,
        @Nullable Instant changedAt,
        List<BriefingChangeDto> changes,
        List<BriefingSourceDto> sources) {
}
