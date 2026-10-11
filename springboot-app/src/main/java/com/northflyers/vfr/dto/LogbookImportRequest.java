package com.northflyers.vfr.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** A logbook brought in from a file (ForeFlight's export, or this one's
 *  own), its entries as the form would send each -- POST
 *  /api/logbook/import. Each is checked as one sent alone is. */
public record LogbookImportRequest(
        @NotNull(message = "entries is required")
        @Size(max = 5000, message = "entries must be 5000 at most: import a long logbook in parts")
        List<@Valid LogbookEntryRequest> entries) {
}
