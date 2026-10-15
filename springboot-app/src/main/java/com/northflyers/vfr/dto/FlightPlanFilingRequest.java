package com.northflyers.vfr.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import org.springframework.lang.Nullable;

/**
 * A flight plan to file, FAA Form 7233-4's items as AIM Appendix 4 writes
 * each (the Brief's flight plan form, lib/flightPlanForm): POST
 * /api/flight-service/flight-plans. The identifiers are up to 11
 * characters, as Flight Service takes an FAA identifier (C81) where an
 * ICAO one is wanted.
 */
@Schema(description = "A flight plan, FAA Form 7233-4's items")
public record FlightPlanFilingRequest(
        @NotNull @Pattern(regexp = "IFR|VFR", message = "rules must be IFR or VFR") String rules,
        @NotBlank @Pattern(regexp = "[A-Z0-9]{2,7}", message = "aircraftId must be 2 to 7 letters and figures") String aircraftId,
        @NotBlank @Pattern(regexp = "[A-Z0-9]{2,4}(/[LMHJ])?", message = "aircraftType must be a type designator, with its wake category")
        String aircraftType,
        @NotBlank @Pattern(regexp = "[A-Z0-9]{2,11}", message = "departure must be an identifier") String departure,
        @NotNull @Schema(description = "The departure time, an instant (item 13, UTC)") Instant departureTime,
        @NotBlank @Pattern(regexp = "N\\d{4}", message = "cruisingSpeed must be N and four figures") String cruisingSpeed,
        @NotBlank @Pattern(regexp = "[AF]\\d{3}", message = "cruisingLevel must be A or F and three figures") String cruisingLevel,
        @NotBlank @Size(max = 1000, message = "route must be at most 1000 characters") String route,
        @NotBlank @Pattern(regexp = "[A-Z0-9]{2,11}", message = "destination must be an identifier") String destination,
        @Min(value = 1, message = "eetMinutes must be a minute or more") @Max(value = 2400, message = "eetMinutes must be 40 hours at most")
        int eetMinutes,
        @Nullable @Pattern(regexp = "[A-Z0-9]{2,11}", message = "alternate must be an identifier") String alternate,
        @Nullable @Size(max = 500, message = "otherInformation must be at most 500 characters") String otherInformation,
        @Min(value = 1, message = "enduranceMinutes must be a minute or more") @Max(value = 2400, message = "enduranceMinutes must be 40 hours at most")
        int enduranceMinutes,
        @Nullable @Min(value = 1, message = "personsOnBoard must be one or more") @Max(value = 999, message = "personsOnBoard must be 999 at most")
        Integer personsOnBoard) {
}
