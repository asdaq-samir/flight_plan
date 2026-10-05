package com.northflyers.vfr.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** A flight's flown track, as the page reads it from the pilot's file
 *  (lib/track) and thins it: the file's name, and its points in time
 *  order. In and out of PUT and GET /api/flights/{id}/track alike. */
public record TrackDto(
        @NotBlank(message = "source is required")
        @Size(max = 120, message = "source must be at most 120 characters")
        String source,
        @NotNull(message = "points is required")
        @Size(min = 2, max = 5000, message = "a track has 2 to 5000 points")
        List<@Valid @NotNull TrackPointDto> points) {
}
