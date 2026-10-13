package com.northflyers.vfr.dto;

import java.time.LocalDate;
import org.springframework.lang.Nullable;

/** An endorsement recorded from paper: its code (EndorsementKind), the
 *  day, and the day it runs out where it does. */
public record EndorsementDto(String code, LocalDate endorsedOn, @Nullable LocalDate until) {
}
