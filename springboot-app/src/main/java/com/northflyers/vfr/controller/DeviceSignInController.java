package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.ErrorResponse;
import com.northflyers.vfr.security.MagicLinkAuthenticationToken;
import com.northflyers.vfr.security.SessionSignIn;
import com.northflyers.vfr.security.SignInLanding;
import com.northflyers.vfr.service.PilotService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Signing a TV in from a phone (docs/TV.md), as streaming apps and the
 * OAuth device flow (RFC 8628) do: the emailed link opens on the phone
 * where the mail is read, never on the TV, and a TV has no keyboard worth
 * typing an address on. Three steps:
 *
 * <ol>
 *   <li>The TV asks for a code ({@code POST /api/auth/device}): a secret
 *       device code it keeps, and a short user code it shows, with the
 *       address to type it at ({@code /tv}, WebMvcConfig).</li>
 *   <li>The pilot, signed in on the phone, types the user code there
 *       ({@code POST /api/auth/device/approve}): the code is now theirs.</li>
 *   <li>The TV, asking every few seconds with its device code ({@code POST
 *       /api/auth/device/token}), is told to wait until then, and then
 *       signed in on its own session as that pilot, as the magic link
 *       signs a browser in -- once: the code is spent.</li>
 * </ol>
 *
 * <p>Ten minutes to finish it in. Held in memory, not the database: a
 * code lives minutes, there is one server, and a restart only means the
 * TV shows a new one. Only the device code's hash is kept, as the magic
 * link keeps its token's. The user code is eight letters and figures from
 * twenty-eight, no vowels (no word is spelled) and none read as another
 * (no 0, O, 1, I): 28^8, near four hundred billion, against the
 * approvals one pilot may try, ten in ten minutes, one place twenty, and
 * the whole server three hundred.
 */
@RestController
@RequestMapping("/api/auth/device")
public class DeviceSignInController {

    static final Duration LIFETIME = Duration.ofMinutes(10);
    /** How often the TV asks, seconds (RFC 8628's interval). */
    static final int INTERVAL_S = 3;
    static final String ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
    private static final int USER_CODE_LENGTH = 8;

    /** A code a TV is showing: its user code, until when, and whose it is
     *  once a pilot has typed it in. */
    private static final class Pending {
        final String userCode;
        final Instant expiresAt;
        final AtomicReference<String> approvedEmail = new AtomicReference<>();

        Pending(String userCode, Instant expiresAt) {
            this.userCode = userCode;
            this.expiresAt = expiresAt;
        }
    }

    private final PilotService pilots;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    /** By the device code's hash. */
    private final Map<String, Pending> byDevice = new ConcurrentHashMap<>();
    /** The device code's hash, by the user code. */
    private final Map<String, String> byUser = new ConcurrentHashMap<>();
    private final SlidingWindowLimiter starts = new SlidingWindowLimiter(Duration.ofHours(1));
    private final SlidingWindowLimiter approvals = new SlidingWindowLimiter(Duration.ofMinutes(10));
    /** Tries at user codes in ten minutes: by pilot, by place, and all together. */
    static final int TRIES_PER_PILOT = 10;
    static final int TRIES_PER_PLACE = 20;
    static final int TRIES_IN_ALL = 300;

    @Autowired
    public DeviceSignInController(PilotService pilots) {
        this(pilots, Clock.systemUTC());
    }

    DeviceSignInController(PilotService pilots, Clock clock) {
        this.pilots = pilots;
        this.clock = clock;
    }

    /** What the TV shows and keeps. */
    public record DeviceCode(String deviceCode, String userCode, String verificationPath, int expiresIn, int interval) {}

    /** The code a pilot typed in on the phone. */
    public record Approval(@NotBlank @Size(max = 20) String userCode) {}

    /** The TV's own code, asked with. */
    public record TokenRequest(@NotBlank @Size(max = 100) String deviceCode) {}

    /** Not yet: ask again in `interval` seconds. */
    public record Waiting(String status, int interval) {}

    /** Signed in: where the TV goes next (SignInLanding). */
    public record SignedIn(String next) {}

    @Operation(summary = "A code for a TV to sign in with",
            description = "The TV shows `userCode` and the address `verificationPath` on this site, and asks "
                    + "/api/auth/device/token with `deviceCode` every `interval` seconds until a pilot signed in "
                    + "on a phone types the code in. 429 past twenty an hour from one place.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", content = @Content(schema = @Schema(implementation = DeviceCode.class))),
        @ApiResponse(responseCode = "429", description = "Too many codes asked for from here")
    })
    @PostMapping
    public ResponseEntity<?> start(HttpServletRequest request) {
        Instant now = clock.instant();
        if (!starts.allow("client:" + SlidingWindowLimiter.clientOf(request), 20, now)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(new ErrorResponse("Too many codes asked for. Wait a few minutes."));
        }
        forgetExpired(now);
        byte[] secret = new byte[32];
        random.nextBytes(secret);
        String deviceCode = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        String userCode;
        do {
            userCode = userCode();
        } while (byUser.containsKey(userCode));
        String hash = hash(deviceCode);
        byDevice.put(hash, new Pending(userCode, now.plus(LIFETIME)));
        byUser.put(userCode, hash);
        return ResponseEntity.ok(new DeviceCode(deviceCode, userCode.substring(0, 4) + "-" + userCode.substring(4), "/tv",
                (int) LIFETIME.toSeconds(), INTERVAL_S));
    }

    @Operation(summary = "Sign in the TV showing this code as the pilot signed in here",
            description = "From the phone, signed in. 404 for a code no TV is showing now (mistyped, used or ten "
                    + "minutes old); 429 past ten tries in ten minutes.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "The TV will be signed in at its next ask"),
        @ApiResponse(responseCode = "401", description = "Not signed in on this phone"),
        @ApiResponse(responseCode = "404", description = "No TV is showing that code now"),
        @ApiResponse(responseCode = "429", description = "Too many tries")
    })
    @PostMapping("/approve")
    public ResponseEntity<?> approve(@Valid @RequestBody Approval body, HttpServletRequest request,
            Authentication authentication) {
        Optional<Pilot> pilot = pilots.current(authentication);
        if (pilot.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("Sign in on this phone first."));
        }
        Instant now = clock.instant();
        // A pilot account costs an email address, so ten tries each is no
        // ceiling on a person with many: the place the tries come from and
        // the server as a whole are capped too. Real pilots approve a
        // handful of codes an hour.
        if (!approvals.allow("pilot:" + pilot.get().getEmail(), TRIES_PER_PILOT, now)
                || !approvals.allow("client:" + SlidingWindowLimiter.clientOf(request), TRIES_PER_PLACE, now)
                || !approvals.allow("all", TRIES_IN_ALL, now)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(new ErrorResponse("Too many tries. Wait a few minutes."));
        }
        String typed = body.userCode().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        String hash = byUser.get(typed);
        // Inside the map's own lock for the key, so the first approver wins
        // and a TV that has just collected its sign-in (token() removes the
        // entry) is not approved for nothing.
        AtomicBoolean approved = new AtomicBoolean();
        if (hash != null) {
            byDevice.computeIfPresent(hash, (key, pending) -> {
                if (!pending.expiresAt.isBefore(now)) {
                    approved.set(pending.approvedEmail.compareAndSet(null, pilot.get().getEmail()));
                }
                return pending;
            });
        }
        if (!approved.get()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ErrorResponse("No TV is showing that code now. Check it, or ask the TV for a new one."));
        }
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "The TV asking whether its code has been typed in",
            description = "202 while not yet; 200 once it has, the TV then signed in on this session, the code "
                    + "spent; 410 for a code ten minutes old or unknown, for which the TV asks for a new one.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Signed in; `next` is where to go",
                content = @Content(schema = @Schema(implementation = SignedIn.class))),
        @ApiResponse(responseCode = "202", description = "Not yet; ask again in `interval` seconds",
                content = @Content(schema = @Schema(implementation = Waiting.class))),
        @ApiResponse(responseCode = "410", description = "The code is spent, too old or unknown")
    })
    @PostMapping("/token")
    public ResponseEntity<?> token(@Valid @RequestBody TokenRequest body, HttpServletRequest request,
            HttpServletResponse response) {
        String hash = hash(body.deviceCode());
        Pending pending = byDevice.get(hash);
        Instant now = clock.instant();
        if (pending == null || pending.expiresAt.isBefore(now)) {
            forget(hash);
            return ResponseEntity.status(HttpStatus.GONE).body(new ErrorResponse("This code has run out. Ask for a new one."));
        }
        String approvedEmail = pending.approvedEmail.get();
        if (approvedEmail == null) {
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(new Waiting("pending", INTERVAL_S));
        }
        // Spent before the sign-in, so two asks at once cannot both sign in.
        if (byDevice.remove(hash) == null) {
            return ResponseEntity.status(HttpStatus.GONE).body(new ErrorResponse("This code has run out. Ask for a new one."));
        }
        byUser.remove(pending.userCode);
        Pilot pilot = pilots.fromVerifiedEmail(approvedEmail);
        Authentication authentication = new MagicLinkAuthenticationToken(pilot.getEmail());
        SessionSignIn.signIn(authentication, request, response);
        return ResponseEntity.ok(new SignedIn(SignInLanding.after(pilot)));
    }

    private String userCode() {
        StringBuilder code = new StringBuilder(USER_CODE_LENGTH);
        for (int i = 0; i < USER_CODE_LENGTH; i++) {
            code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }

    private void forget(String hash) {
        Pending gone = byDevice.remove(hash);
        if (gone != null) {
            byUser.remove(gone.userCode);
        }
    }

    private void forgetExpired(Instant now) {
        byDevice.entrySet().removeIf(entry -> {
            if (entry.getValue().expiresAt.isBefore(now)) {
                byUser.remove(entry.getValue().userCode);
                return true;
            }
            return false;
        });
    }

    private static String hash(String code) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
