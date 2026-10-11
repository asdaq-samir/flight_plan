package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.DeferredFor;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** A squawk as its form sends it -- POST and PUT
 *  /api/aircraft/{id}/squawks. `deferredFor` is an inoperative item's
 *  91.213(d) determination, the kinds of flight it covers; none, none
 *  made. Fixed with `fixedOn`. */
public record SquawkRequest(
        @NotNull(message = "reportedOn is required") @PastOrPresent(message = "reportedOn cannot be in the future")
        LocalDate reportedOn,
        @NotBlank(message = "text is required") @Size(max = 500, message = "text must be at most 500 characters") String text,
        boolean inoperative,
        @Nullable DeferredFor deferredFor,
        @Nullable @PastOrPresent(message = "fixedOn cannot be in the future") LocalDate fixedOn,
        @Nullable @Size(max = 500, message = "fixNote must be at most 500 characters") String fixNote) {
}
