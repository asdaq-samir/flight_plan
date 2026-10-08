package com.northflyers.vfr.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.Instant;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * What went wrong on a pilot's phone, written to the server's log -- in
 * production, CloudWatch (docker-compose.prod.yml) -- where the owner
 * sees it, rather than only if the pilot writes in. The page sends one
 * for an uncaught error, a promise nobody caught, and a render React
 * could not finish (web/src/lib/errorReports.ts).
 *
 * <p>Nothing of the pilot's: no session is read, the page's address is
 * kept without its query (a magic link's token rides there), and the
 * fields are cut to their limits. Open to anyone, since an error before
 * sign-in counts as much as one after, and so held to 30 an hour per
 * caller (SlidingWindowLimiter), past which they are dropped without a
 * word: a page in a loop must not fill the log. No CSRF token either:
 * the page sends it with navigator.sendBeacon, which can carry no
 * header, and a forged one can only add a line to the log.
 */
@RestController
@RequestMapping("/api/client-errors")
@Tag(name = "Client errors", description = "Errors on pilots' devices, logged for the owner")
public class ClientErrorController {

    private static final Logger log = LoggerFactory.getLogger(ClientErrorController.class);

    /** Reports per caller per hour. */
    static final int PER_HOUR = 30;

    private final SlidingWindowLimiter recent = new SlidingWindowLimiter(Duration.ofHours(1));

    /** One error, as the page saw it. */
    public record ClientError(
            @NotBlank @Size(max = 500) String message,
            @Size(max = 4000) String stack,
            @Size(max = 300) String page,
            @Size(max = 300) String userAgent,
            @Size(max = 40) String kind) {}

    @Operation(summary = "Report an error on a pilot's device",
            description = "Logged for the owner, without the page's query string; 30 an hour per caller, the rest dropped.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Logged, or dropped past the hour's allowance"),
        @ApiResponse(responseCode = "400", description = "Not an error report")
    })
    @PostMapping
    public ResponseEntity<Void> report(@Valid @RequestBody ClientError error, HttpServletRequest request) {
        if (recent.allow("client:" + SlidingWindowLimiter.clientOf(request), PER_HOUR, Instant.now())) {
            log.warn("client error [{}] {} at {} ({})\n{}", oneLine(error.kind()), withoutQueries(oneLine(error.message())),
                    pathOnly(error.page()), oneLine(error.userAgent()), stackLines(error.stack()));
        }
        return ResponseEntity.noContent().build();
    }

    /** The page's path, never its query or fragment. */
    static String pathOnly(String page) {
        if (page == null) {
            return "";
        }
        int cut = page.length();
        for (char c : new char[] {'?', '#'}) {
            int at = page.indexOf(c);
            if (at >= 0 && at < cut) {
                cut = at;
            }
        }
        return oneLine(page.substring(0, cut));
    }

    /** Text with the query and fragment of any address in it cut off: a fetch error carries the pilot's position. */
    static String withoutQueries(String text) {
        return text.replaceAll("[?#]\\S*", "");
    }

    /** A stack with every line indented, so none can start as a log line of its own, and without queries. */
    static String stackLines(String stack) {
        if (stack == null) {
            return "";
        }
        return withoutQueries(stack).lines().map(line -> "    " + line).collect(Collectors.joining("\n"));
    }

    /** A field on one line, so one report cannot forge another's. */
    private static String oneLine(String text) {
        return text == null ? "" : text.replaceAll("[\\r\\n]+", " ");
    }
}
