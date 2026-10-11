package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.VorCheck;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** A VOR check as the pilot records it (14 CFR 91.171(d)): the date, how
 *  it was made, the place and the bearing error found -- PUT
 *  /api/aircraft/{id}/vor-check. The error is degrees either way. */
public record VorCheckRequest(
        @NotNull(message = "checkedOn is required") @PastOrPresent(message = "checkedOn cannot be in the future")
        LocalDate checkedOn,
        @NotNull(message = "kind is required") VorCheck kind,
        @Size(max = 80, message = "place must be at most 80 characters") @Nullable String place,
        @DecimalMin(value = "-30", message = "errorDeg must be within 30 degrees")
        @DecimalMax(value = "30", message = "errorDeg must be within 30 degrees")
        double errorDeg) {
}
