package com.northflyers.vfr.controller;

import com.northflyers.vfr.dto.ErrorResponse;
import com.northflyers.vfr.service.NoSuchAircraftException;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.apache.coyote.CloseNowException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.util.DisconnectedClientHelper;

/**
 * Turns failure classes into a uniform ErrorResponse instead of an
 * opaque 500 (or, for validation, Spring's own default problem-detail
 * shape) -- a bad request body, an unresolvable aircraft reference, a
 * unique-constraint clash, the wrong HTTP method, and everything else.
 * Ordered most-specific to least-specific, matching how
 * {@code @ExceptionHandler} resolution actually works.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** A browser that left mid-response -- a nav log or detection stream
     *  it stopped reading, a tab closed -- is nobody's error, and there is
     *  nobody left to answer. Spring's own helper knows the signs (a
     *  broken pipe, a reset connection, Tomcat's client abort) and logs
     *  one line on its own category, at debug. Each used to be an ERROR
     *  "Unhandled exception" with a stack trace, then a second failure
     *  writing a JSON body into an NDJSON stream already under way. */
    private static final DisconnectedClientHelper DISCONNECTED =
            new DisconnectedClientHelper("com.northflyers.vfr.disconnected-client");
    private static final Logger disconnected = LoggerFactory.getLogger("com.northflyers.vfr.disconnected-client");

    /**
     * The same, in Tomcat's HTTP/2 words, which Spring's helper (written
     * for HTTP/1.1's broken pipe and reset connection) does not know: the
     * stream reset by the client while its request was still being read
     * or its response written, and a write to a stream already reset
     * ({@link CloseNowException}), wherever in the cause chain Spring MVC
     * left it. Seen while the phone's connector spoke HTTP/2: a page
     * reloaded there with a detection stream in flight logged each of
     * these as an ERROR with a stack trace, then a second failure writing
     * the 500's JSON into the NDJSON already under way -- 240 requests
     * cancelled mid-flight left 262 such lines, against 4 over HTTP/1.1.
     * That connector is HTTP/1.1 now (HttpsConnectorConfig says why);
     * this stays for any connector that speaks HTTP/2 again.
     */
    static boolean streamReset(Throwable ex) {
        Throwable cause = ex;
        for (int depth = 0; cause != null && depth < 10; depth++, cause = cause.getCause()) {
            if (cause instanceof CloseNowException) {
                return true;
            }
            String message = cause.getMessage();
            if (cause instanceof IOException && message != null && message.startsWith("Client reset the stream")) {
                return true;
            }
        }
        return false;
    }

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
     * <p>Spring MVC's own request failures -- no such resource, a
     * missing parameter, an unreadable body -- say which client error
     * they are, and are answered as that. They were all 500s here: a
     * browser asking for a bundle file a new build had replaced was told
     * the server broke, and the log said "Unhandled exception".
     *
     * @param ex the unexpected exception, logged in full server-side
     * @param response the answer under way, which may already be committed
     * @return its own status for a client error Spring MVC names, else 500 with a generic message;
     *         nothing for a client that has gone, or once the response is committed
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex, HttpServletResponse response) {
        if (DISCONNECTED.checkAndLogClientDisconnectedException(ex)) {
            return null;
        }
        if (streamReset(ex)) {
            disconnected.debug("Looks like the client has gone away: {}", ex.toString());
            return null;
        }
        if (response.isCommitted()) {
            // Part of an answer is already on its way (a stream): no body
            // can follow it, so the failure is logged and that is all.
            log.error("Failed after the response was sent", ex);
            return null;
        }
        if (ex instanceof org.springframework.web.ErrorResponse known && known.getStatusCode().is4xxClientError()) {
            String detail = known.getBody().getDetail();
            return ResponseEntity.status(known.getStatusCode())
                    .body(new ErrorResponse(detail != null ? detail : ex.getMessage()));
        }
        log.error("Unhandled exception", ex);
        return ResponseEntity.internalServerError().body(new ErrorResponse("An unexpected error occurred"));
    }
}
