package com.northflyers.vfr.service;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.util.StringUtils;

/**
 * What a pilot or a setting typed, made the one way every service keeps
 * it: blank is none, the ends trimmed. The aircraft, logbook, checklist,
 * squawk, contact and instructor fields each carried their own copy.
 */
public final class Typed {

    private Typed() {
    }

    /** As typed, its ends trimmed; blank is none. */
    public static String text(String typed) {
        return typed == null || typed.isBlank() ? null : typed.strip();
    }

    /** Words as typed, their spaces made single; blank is none. */
    public static String words(String typed) {
        return typed == null || typed.isBlank() ? null : typed.strip().replaceAll("\\s+", " ");
    }

    /** A code in capitals: an airport identifier, or flight plan item
     *  10's codes as the form writes them (AIM Appendix 4, TBL 4-2 and
     *  4-3); blank is none. */
    public static String code(String typed) {
        return typed == null || typed.isBlank() ? null : typed.strip().toUpperCase(Locale.ROOT);
    }

    /** A setting's email addresses, comma-separated, in lower case so a
     *  pilot's address matches whatever case either was written in. */
    public static Set<String> addresses(String commaSeparated) {
        return Arrays.stream(commaSeparated.split(","))
                .map(String::trim).filter(StringUtils::hasText)
                .map(address -> address.toLowerCase(Locale.ROOT))
                .collect(Collectors.toUnmodifiableSet());
    }
}
