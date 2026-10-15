package com.northflyers.vfr.dto;

/** One of the determinations 14 CFR 61.93(d) asks of the instructor, as
 *  far as the student's record answers it. */
public record ReviewCheckDto(String rule, String label, boolean met, String detail) {
}
