package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.VorCheck;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.lang.Nullable;

/** An aeroplane as the API returns it. The cruise power, the climb's
 *  speed and burn, `usableFuelGal` and the flight plan's items are null
 *  when the owner has not said. */
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
        @Nullable VorCheckDto vorCheck,
        @Schema(description = "Its inspections and tests, as recorded, each with the last day it is good for")
        InspectionsDto inspections,
        @Schema(description = "Its squawks not yet fixed, newest first")
        List<SquawkDto> openSquawks,
        @Schema(description = "Its flight plan's item 10a, its navigation, communication and approach equipment "
                + "(AIM Appendix 4, TBL 4-2)", example = "SDFGRY")
        @Nullable String equipment,
        @Schema(description = "Its flight plan's item 10b, its surveillance equipment (AIM Appendix 4, TBL 4-3)",
                example = "B1")
        @Nullable String surveillance,
        @Schema(description = "Its flight plan's item 19 A/, its colour and markings", example = "White Blue")
        @Nullable String colour) {

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

    @Schema(description = "An airplane's inspections and tests as recorded, each with the last day it is good for: "
            + "the annual to the end of the 12th calendar month after (14 CFR 91.409(a)), the altimeter and static test "
            + "and the transponder test to the end of the 24th (91.411(a), 91.413(a)), the ELT's inspection to the end of "
            + "the 12th (91.207(d)); the 100-hour due at 100 hours of time in service after the last (91.409(b)). "
            + "Null where not recorded")
    public record InspectionsDto(
            @Nullable LocalDate annualOn,
            @Nullable LocalDate annualGoodThrough,
            @Nullable Double hundredHourAtHours,
            @Nullable Double hoursNow,
            @Nullable Double hundredHourDueAtHours,
            @Nullable LocalDate staticCheckOn,
            @Nullable LocalDate staticCheckGoodThrough,
            @Nullable LocalDate transponderCheckOn,
            @Nullable LocalDate transponderCheckGoodThrough,
            @Nullable LocalDate eltInspectedOn,
            @Nullable LocalDate eltInspectionGoodThrough,
            @Schema(description = "The date the ELT's battery is to be replaced by, as marked on it (91.207(c))")
            @Nullable LocalDate eltBatteryDueOn) {
    }
}
