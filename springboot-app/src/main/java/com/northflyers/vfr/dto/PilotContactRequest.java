package com.northflyers.vfr.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.lang.Nullable;

/** The pilot's telephone number and home base -- PUT /api/me/contact --
 *  for a flight plan's item 19 C/, the pilot in command's contact
 *  information (AIM Appendix 4), as {@link FullNameRequest} gives their
 *  name. A number is figures with the marks one is written with; a home
 *  base is an airport identifier of 2 to 11 letters and figures, as
 *  Flight Service takes an FAA one (C81) where an ICAO one is wanted
 *  ({@link FlightPlanFilingRequest}). Blank, or left out, is none. */
public record PilotContactRequest(
        @Size(max = 24, message = "phone must be at most 24 characters")
        @Pattern(regexp = "[0-9+()\\-. ]*", message = "phone must be figures, spaces and + ( ) - .")
        @Nullable String phone,
        @Pattern(regexp = "\\s*([A-Za-z0-9]{2,11})?\\s*", message = "homeBase must be an airport identifier")
        @Nullable String homeBase) {
}
