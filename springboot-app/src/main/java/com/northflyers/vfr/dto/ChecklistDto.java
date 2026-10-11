package com.northflyers.vfr.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.lang.Nullable;

/** An airplane's checklist, its sections in order, each its items -- as
 *  GET /api/aircraft/{id}/checklist answers and PUT takes it, whole. */
@Schema(description = "An airplane's checklist, as its owner writes it from its flight manual")
public record ChecklistDto(
        @NotNull(message = "sections is required")
        @Size(max = 20, message = "sections must be 20 at most")
        List<@Valid Section> sections) {

    /** A phase of the flight's items: Preflight, Before takeoff. */
    @Schema(name = "ChecklistSection")
    public record Section(
            @NotBlank(message = "a section needs a title")
            @Size(max = 40, message = "a section's title must be at most 40 characters") String title,
            @NotNull(message = "items is required")
            @Size(max = 80, message = "a section must have 80 items at most")
            List<@Valid Item> items) {
    }

    /** A challenge and its response: "Fuel selector", "Both". */
    @Schema(name = "ChecklistEntry")
    public record Item(
            @NotBlank(message = "an item needs its challenge")
            @Size(max = 80, message = "a challenge must be at most 80 characters") String challenge,
            @Size(max = 80, message = "a response must be at most 80 characters") @Nullable String response) {
    }
}
