package com.northflyers.vfr.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/** The ACS codes on the pilot's knowledge test report, as they type
 *  them -- PUT /api/training/knowledge-test; an empty list clears them. */
public record KnowledgeTestRequest(
        @NotNull @Size(max = 120, message = "at most 120 codes")
        List<@Pattern(regexp = "^[A-Z]{2}\\.[IVX]{1,4}\\.[A-Z]\\.[KRS]\\d{1,2}[a-z]?$",
                message = "an ACS code, as PA.I.E.K1 or IR.III.B.K2") String> codes) {
}
