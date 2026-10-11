package com.northflyers.vfr.controller;

import com.northflyers.vfr.service.SpeedService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * How fast the web app is, kept so the trend can be seen in the developer
 * console's Speed tab (SpeedService, V25). Two sources:
 *
 * <ul>
 *   <li><b>field</b>, from pilots' browsers (web/src/lib/speed.ts): Google's
 *   Core Web Vitals -- LCP, INP and CLS -- with FCP and TTFB, for the page,
 *   the kind of device and the app's build. Nothing of the pilot's: no
 *   session is read, no address kept (the caller's is used, in memory
 *   only, for the hourly allowance), no route, no position. Open to
 *   anyone, since a page is as slow signed out as in, and so held to 60
 *   reports an hour per caller, the rest dropped without a word. No CSRF
 *   token: the page sends it with navigator.sendBeacon as it is put away,
 *   which carries no header, and a forged one only adds a sample.</li>
 *   <li><b>lab</b>, from the nightly measurement in CI (ci.yml, Speed
 *   trend): the same steps timed on the same kind of machine every night,
 *   with the commit measured. Only with the deployment's lab token
 *   (app.speed.lab-token) in X-Speed-Token; with none set, refused.</li>
 * </ul>
 *
 * <p>The trend is the developer's (SecurityConfig).
 */
@RestController
@RequestMapping("/api/speed")
@Tag(name = "Speed", description = "The web app's speed over time, from pilots' browsers and the nightly lab run")
public class SpeedController {

    /** Reports per caller per hour: a page sends one as it is put away. */
    static final int PER_HOUR = 60;

    /** The most days the trend goes back: as long as a sample is kept. */
    static final int MOST_DAYS = 400;

    private static final String NAME = "[a-z][a-z0-9-]{0,39}";
    private static final String DEVICE = "phone|tablet|desktop";
    private static final String VERSION = "[A-Za-z0-9._-]{1,40}";

    private final SpeedService speed;
    private final byte[] labToken;
    private final SlidingWindowLimiter recent = new SlidingWindowLimiter(Duration.ofHours(1));

    public SpeedController(SpeedService speed, @Value("${app.speed.lab-token:}") String labToken) {
        this.speed = speed;
        this.labToken = labToken.getBytes(StandardCharsets.UTF_8);
    }

    /** A page's Core Web Vitals and timings in milliseconds (CLS has no unit). */
    public record FieldReport(
            @NotNull @Pattern(regexp = NAME) String page,
            @NotNull @Pattern(regexp = DEVICE) String device,
            @NotNull @Pattern(regexp = VERSION) String version,
            @NotNull @Size(min = 1, max = 5) Map<@Pattern(regexp = "LCP|INP|CLS|FCP|TTFB") String,
                    @NotNull @DecimalMin("0") @DecimalMax("600000") Double> metrics) {}

    /** A night's measurements, each named in lower case (open_app, lighthouse_performance, first_load_kb). */
    public record LabReport(
            @NotNull @Pattern(regexp = NAME) String page,
            @NotNull @Pattern(regexp = DEVICE) String device,
            @NotNull @Pattern(regexp = VERSION) String commit,
            @NotNull @Size(min = 1, max = 60) Map<@Pattern(regexp = "[a-z][a-z0-9_]{0,39}") String,
                    @NotNull @DecimalMin("0") @DecimalMax("100000000") Double> metrics) {}

    /** One day of one metric from one source on one kind of device: its
     *  median and 75th percentile, how many samples, and the highest build
     *  or commit seen. */
    public record SpeedDay(String day, String source, String metric, String device, double p50, double p75,
            long count, String version) {}

    @Operation(summary = "Report a page's speed from a pilot's browser",
            description = "Core Web Vitals and timings, nothing of the pilot's; 60 an hour per caller, the rest dropped.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Kept, or dropped past the hour's allowance"),
        @ApiResponse(responseCode = "400", description = "Not a speed report")
    })
    @PostMapping("/field")
    public ResponseEntity<Void> field(@Valid @RequestBody FieldReport report, HttpServletRequest request) {
        if (recent.allow("speed:" + SlidingWindowLimiter.clientOf(request), PER_HOUR, Instant.now())) {
            speed.record("field", report.page(), report.device(), report.version(), report.metrics());
        }
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Report the nightly lab measurement",
            description = "Only with the deployment's lab token in X-Speed-Token.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Kept"),
        @ApiResponse(responseCode = "400", description = "Not a lab report"),
        @ApiResponse(responseCode = "403", description = "No token, the wrong one, or none set here")
    })
    @PostMapping("/lab")
    public ResponseEntity<Void> lab(@Valid @RequestBody LabReport report,
            @RequestHeader(value = "X-Speed-Token", required = false) String token) {
        // Compared in constant time, and never against an empty token.
        boolean allowed = labToken.length > 0 && token != null
                && MessageDigest.isEqual(labToken, token.getBytes(StandardCharsets.UTF_8));
        if (!allowed) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        speed.record("lab", report.page(), report.device(), report.commit(), report.metrics());
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "The speed trend, a day at a time",
            description = "Each day's median and 75th percentile by source, metric and device, oldest first; the developer's.")
    @GetMapping
    public List<SpeedDay> trend(@RequestParam(defaultValue = "90") int days) {
        return speed.trend(Math.max(1, Math.min(MOST_DAYS, days))).stream()
                .map(d -> new SpeedDay(d.getDay(), d.getSource(), d.getMetric(), d.getDevice(), d.getP50(), d.getP75(),
                        d.getCount(), d.getVersion()))
                .toList();
    }
}
