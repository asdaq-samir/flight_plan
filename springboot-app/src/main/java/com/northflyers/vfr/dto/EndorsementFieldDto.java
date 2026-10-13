package com.northflyers.vfr.dto;

/** A blank in an endorsement's words, as the instructor's sheet asks for it. */
public record EndorsementFieldDto(String key, String label, String example, boolean required) {
}
