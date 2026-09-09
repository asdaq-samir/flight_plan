package com.northflyers.vfr.controller;

import com.northflyers.vfr.dto.ErrorResponse;
import com.northflyers.vfr.service.ModelServiceException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns three failure classes into a uniform ErrorResponse instead of an
 * opaque 500 (or, for validation, Spring's own default problem-detail
 * shape) -- a bad request body, model-service being unreachable, and
 * everything else. Ordered most-specific to least-specific, matching how
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
