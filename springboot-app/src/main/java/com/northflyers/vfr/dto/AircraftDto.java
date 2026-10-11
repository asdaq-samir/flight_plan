package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.VorCheck;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** An aeroplane as the API returns it. The cruise power, the climb's
 *  speed and burn and `usableFuelGal` are null when the owner has not
 *  said. */
public record AircraftDto(
        Long id,
        String tailNumber,
        String typeDesignator,
        double cruiseTasKt,
        double fuelBurnGph,
        @Nullable Double cruisePowerPct,
        @Nullable Double climbTasKt,
        @Nullable Double climbFuelBurnGph,
        @Nullable Double usableFuelGal,
        Instant createdAt,
        @Schema(description = "Its last VOR check for IFR (14 CFR 91.171): when, how, where, the bearing error, and "
                + "the last day it is good for -- 30 days on, if the error was within the check's limit")
        @Nullable VorCheckDto vorCheck) {

    @Schema(description = "A VOR check for IFR (14 CFR 91.171)")
    public record VorCheckDto(
            LocalDate checkedOn,
            VorCheck kind,
            @Nullable String place,
            double errorDeg,
            @Schema(description = "The largest error 91.171 allows for this kind of check, degrees") double limitDeg,
            @Schema(description = "Within the limit") boolean withinLimit,
            @Schema(description = "The last day it is good for: 30 days on (91.171(a)(2))") LocalDate goodThrough) {
    }
}
