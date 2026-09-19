package com.northflyers.vfr.controller;

import com.northflyers.vfr.dto.ErrorResponse;
import com.northflyers.vfr.service.ModelServiceException;
import com.northflyers.vfr.service.NoSuchAircraftException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns failure classes into a uniform ErrorResponse instead of an
 * opaque 500 (or, for validation, Spring's own default problem-detail
 * shape) -- a bad request body, an unresolvable aircraft reference, a
 * unique-constraint clash, model-service being unreachable, the wrong
 * HTTP method, and everything else. Ordered most-specific to
 * least-specific, matching how
 * {@code @ExceptionHandler} resolution actually works.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * Handles a failed {@code @Valid} check on a request body.
     *
     * @param ex the validation failure, carrying one field error per broken constraint
     * @return 400 with each field's error message
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        List<String> details = ex.getBindingResult().getFieldErrors().stream()
                .map(fieldError -> fieldError.getField() + ": " + fieldError.getDefaultMessage())
                .toList();
        return ResponseEntity.badRequest().body(new ErrorResponse("Invalid request", details));
    }

    /**
     * Handles a {@code SaveFlightRequest} naming an {@code aircraftId}
     * that doesn't exist or doesn't belong to the calling pilot.
     *
     * @param ex carries the id that didn't resolve
     * @return 404 with that detail
     */
    @ExceptionHandler(NoSuchAircraftException.class)
    public ResponseEntity<ErrorResponse> handleNoSuchAircraft(NoSuchAircraftException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ErrorResponse(ex.getMessage()));
    }

    /**
     * Handles a unique-constraint violation -- in practice, registering
     * an aircraft whose tail number the same pilot already has on file
     * ({@code uq_aircraft_pilot_tail}).
     *
     * @param ex the underlying constraint failure, logged in full server-side
     * @return 409, with a message that doesn't leak constraint/SQL internals
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleDataIntegrityViolation(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation", ex);
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ErrorResponse("That tail number is already registered"));
    }

    /**
     * Handles model-service (or SageMaker) being unreachable.
     *
     * @param ex the underlying transport failure, logged in full server-side
     * @return 502, with a message that doesn't leak transport internals to the caller
     */
    @ExceptionHandler(ModelServiceException.class)
    public ResponseEntity<ErrorResponse> handleModelServiceException(ModelServiceException ex) {
        log.error("model-service call failed", ex);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ErrorResponse("The model-scoring service is currently unavailable"));
    }

    /**
     * Handles a request using a method the path doesn't map, such as
     * {@code GET /api/routes}. Without this the catch-all below would
     * report it as a 500, and a caller could not tell "wrong method"
     * from "server broke".
     *
     * @param ex names the unsupported method
     * @return 405 with that detail
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(new ErrorResponse(ex.getMessage()));
    }

    /**
     * Catches everything not handled above -- the last line of defense
     * against an opaque, stack-trace-leaking default error page.
     *
     * @param ex the unexpected exception, logged in full server-side
     * @return 500, with a generic message
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.internalServerError().body(new ErrorResponse("An unexpected error occurred"));
    }
}
