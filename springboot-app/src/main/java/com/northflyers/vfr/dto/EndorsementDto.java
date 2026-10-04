package com.northflyers.vfr.dto;

import java.time.LocalDate;

/** An endorsement given: the page's code for it and the day. */
public record EndorsementDto(String code, LocalDate endorsedOn) {
}
