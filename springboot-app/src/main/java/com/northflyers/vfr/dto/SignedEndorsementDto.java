package com.northflyers.vfr.dto;

import java.time.LocalDate;
import java.util.Map;
import org.springframework.lang.Nullable;

/** An endorsement signed in the app: the words and the signature line as
 *  signed, the day, the day it runs out where it does, and whether a
 *  correction has voided it. */
public record SignedEndorsementDto(
        Long id,
        String code,
        String studentName,
        Map<String, String> fields,
        String text,
        /** "/s/ 10-13-2026 J. J. Jones 987654321CFI RE 12-31-2026". */
        String signature,
        LocalDate signedOn,
        @Nullable LocalDate until,
        boolean voided,
        /** SHA-256 of the words, the signature line and the moment signed. */
        String digest) {
}
