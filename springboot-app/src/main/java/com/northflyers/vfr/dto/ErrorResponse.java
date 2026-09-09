package com.northflyers.vfr.dto;

import java.util.List;

/** Uniform error body for every 4xx/5xx this app returns -- see GlobalExceptionHandler. */
public record ErrorResponse(String error, List<String> details) {

    public ErrorResponse(String error) {
        this(error, List.of());
    }
}
