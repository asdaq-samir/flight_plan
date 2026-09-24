package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.MagicLink;
import com.northflyers.vfr.dto.MagicLinkRequest;
import com.northflyers.vfr.repository.MagicLinkRepository;
import com.northflyers.vfr.security.MagicLinkAuthenticationToken;
import com.northflyers.vfr.service.PilotService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletRequestWrapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;
import org.springframework.web.util.HtmlUtils;

/**
 * The magic-link sign-in flow's own two steps. Deliberately not folded
 * into {@link PilotController} -- that one is "who am I," this is "how
 * I got here," and the two have almost nothing in common: this
 * controller never checks {@code Authentication} at all, since both its
 * endpoints exist specifically for a caller who has none yet.
 *
 * <p>{@code request} always answers 202 regardless of whether the
 * address has ever signed in before -- an email is sent, and the actual
 * pilot lookup/creation ({@link PilotService#fromVerifiedEmail}) doesn't
 * happen until {@code verify} actually confirms control of that address.
 * Answering differently for a known vs. unknown email would let a
 * caller enumerate which addresses have accounts here.
 */
@RestController
@RequestMapping("/api/auth/magic-link")
public class MagicLinkController {

    private static final Logger log = LoggerFactory.getLogger(MagicLinkController.class);
    private static final Duration TOKEN_LIFETIME = Duration.ofMinutes(15);
    private static final Duration THROTTLE_WINDOW = Duration.ofHours(1);

    private final MagicLinkRepository magicLinks;
    private final PilotService pilots;
    private final JavaMailSender mailSender;
    private final String fromAddress;
    /** Where the emailed link points, e.g. https://planner.example.com.
     *  Never the request's own Host or X-Forwarded-Host: those are the
     *  caller's to set, and a link built from them sends the victim's
     *  token to whichever host the caller named. */
    private final String publicBaseUrl;
    private final int perAddressPerHour;
    private final int perClientPerHour;
    private final Map<String, Deque<Instant>> recentRequests = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final SecurityContextRepository securityContextRepository = new HttpSessionSecurityContextRepository();
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy =
            new ChangeSessionIdAuthenticationStrategy();

    public MagicLinkController(MagicLinkRepository magicLinks, PilotService pilots, JavaMailSender mailSender,
            @Value("${MAIL_FROM:no-reply@northflyers.com}") String fromAddress,
            @Value("${spring.mail.host:}") String mailHost,
            @Value("${app.public-base-url:}") String publicBaseUrl,
            @Value("${app.magic-link.per-address-per-hour:5}") int perAddressPerHour,
            @Value("${app.magic-link.per-client-per-hour:20}") int perClientPerHour) {
        this.magicLinks = magicLinks;
        this.pilots = pilots;
        this.mailSender = mailSender;
        this.fromAddress = fromAddress;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
        this.perAddressPerHour = perAddressPerHour;
        this.perClientPerHour = perClientPerHour;
        // A deployment that can send the email must say where the link
        // goes; building it from the request is only for a machine that
        // sends nothing (the link is logged, not mailed).
        if (!mailHost.isBlank() && this.publicBaseUrl.isBlank()) {
            throw new IllegalStateException(
                    "APP_PUBLIC_BASE_URL (app.public-base-url) must be set when MAIL_HOST is: the sign-in link is built from it");
        }
    }

    @Operation(summary = "Start a magic-link sign-in",
            description = "Always 202 -- the response never reveals whether the address has signed in before.")
    @PostMapping
    public ResponseEntity<Void> request(@Valid @RequestBody MagicLinkRequest body, HttpServletRequest request) {
        Instant now = Instant.now();
        // Throttled per address and per caller, whether or not the
        // address has an account, so the answer still says nothing about
        // who does -- but nobody can fill a stranger's inbox from here.
        if (!allow("email:" + body.email().toLowerCase(), perAddressPerHour, now)
                || !allow("client:" + clientOf(request), perClientPerHour, now)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).build();
        }
        magicLinks.deleteExpiredBefore(now.minus(Duration.ofDays(1)));
        String rawToken = generateToken();
        // Only the hash is stored -- see MagicLink's own javadoc. The
        // raw token exists only in this method's own stack and in the
        // email it's about to go out in.
        magicLinks.save(new MagicLink(body.email(), hash(rawToken), now.plus(TOKEN_LIFETIME)));
        String verifyUrl = (publicBaseUrl.isBlank()
                ? ServletUriComponentsBuilder.fromRequestUri(request).replacePath("").replaceQuery(null).build().toUriString()
                : publicBaseUrl)
                + "/api/auth/magic-link/verify?token=" + rawToken;
        sendEmail(body.email(), verifyUrl);
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }

    /**
     * Who is asking, for the per-client limit: the last X-Forwarded-For
     * entry -- the one the load balancer in front of this app appended,
     * the address it was connected from -- or, with no proxy in front,
     * the connection's own address. Read from the request as the
     * container received it: {@code forward-headers-strategy: framework}
     * makes {@code getRemoteAddr()} the <em>first</em> entry, which the
     * caller writes, and hides the header. Keyed on that, a caller could
     * dodge the limit with a new X-Forwarded-For on every request (seen:
     * 25 in a row accepted against a limit of 20). With no proxy in front
     * the caller can still write the last entry too; but mail is only
     * ever sent from a deployment behind the load balancer.
     */
    static String clientOf(HttpServletRequest request) {
        ServletRequest received = request;
        while (received instanceof ServletRequestWrapper wrapper) {
            received = wrapper.getRequest();
        }
        String forwarded = received instanceof HttpServletRequest http ? http.getHeader("X-Forwarded-For") : null;
        if (forwarded != null && !forwarded.isBlank()) {
            String[] hops = forwarded.split(",");
            return hops[hops.length - 1].trim();
        }
        return received.getRemoteAddr();
    }

    /** Whether one more request for `key` fits in the last hour, and if
     *  so, count it. */
    private boolean allow(String key, int limit, Instant now) {
        if (recentRequests.size() > 10_000) {
            // Forget callers with nothing in the window, so a spray of
            // one-off addresses cannot grow this without bound.
            recentRequests.values().removeIf(times -> {
                synchronized (times) {
                    return times.isEmpty() || times.peekLast().isBefore(now.minus(THROTTLE_WINDOW));
                }
            });
        }
        Deque<Instant> times = recentRequests.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && times.peekFirst().isBefore(now.minus(THROTTLE_WINDOW))) {
                times.pollFirst();
            }
            if (times.size() >= limit) {
                return false;
            }
            times.addLast(now);
            return true;
        }
    }

    @Operation(summary = "The page a magic link opens",
            description = "A one-button page that signs in with a POST. Opening the link uses nothing up, so a mail "
                    + "scanner that fetches it before the pilot does cannot spend their token.")
    @GetMapping(value = "/verify", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> confirm(@RequestParam String token, HttpServletRequest request) {
        CsrfToken csrf = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        String csrfField = csrf == null ? "" : "<input type=\"hidden\" name=\"" + HtmlUtils.htmlEscape(csrf.getParameterName())
                + "\" value=\"" + HtmlUtils.htmlEscape(csrf.getToken()) + "\">";
        String page = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Sign in</title></head>"
                + "<body style=\"font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem\">"
                + "<h1 style=\"font-size:1.4rem\">Sign in to VFR Route</h1>"
                + "<form method=\"post\" action=\"/api/auth/magic-link/verify\">"
                + "<input type=\"hidden\" name=\"token\" value=\"" + HtmlUtils.htmlEscape(token) + "\">" + csrfField
                + "<button type=\"submit\" style=\"font-size:1rem;padding:.6rem 1.2rem\">Sign in</button>"
                + "</form></body></html>";
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(page);
    }

    @Operation(summary = "Sign in from a magic link",
            description = "302 to the planner, now signed in, on success; 400 for an expired, already-used or unrecognized token.")
    @PostMapping(value = "/verify", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    public ResponseEntity<String> verify(
            @RequestParam String token, HttpServletRequest request, HttpServletResponse response) {
        String tokenHash = hash(token);
        // Atomic consume-if-usable, not find-then-filter-then-save: the
        // old sequence had a window where two requests racing the same
        // token could both read "still usable" before either wrote
        // consumedAt, and both would sign in. See
        // MagicLinkRepository.consumeIfUsable's own javadoc.
        if (magicLinks.consumeIfUsable(tokenHash, Instant.now()) == 0) {
            return ResponseEntity.badRequest()
                    .body("This link has expired or was already used. Ask for a new one from the Pilot menu.");
        }
        MagicLink link = magicLinks.findByTokenHash(tokenHash).orElseThrow();
        var pilot = pilots.fromVerifiedEmail(link.getEmail());
        Authentication authentication = new MagicLinkAuthenticationToken(pilot.getEmail());

        // Spring Security's own session-fixation strategy, run by hand
        // because this endpoint is outside the filter chain that would
        // otherwise run it. A session that existed before the click --
        // one a pilot arrived with, or one someone else planted in their
        // browser -- must not be the session they end up signed in on.
        // oauth2Login gets this from AbstractAuthenticationProcessingFilter;
        // this flow has no such filter, so it asks for the same thing
        // directly rather than going without.
        sessionAuthenticationStrategy.onAuthentication(authentication, request, response);

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        // Explicit save, not just setContext above -- outside Spring
        // Security's own filter chain (there is no
        // AuthenticationSuccessHandler here, this endpoint *is* the
        // success handler), nothing else persists the context into the
        // session for the next request.
        securityContextRepository.saveContext(context, request, response);
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create("/app/plan"))
                .build();
    }

    private void sendEmail(String to, String verifyUrl) {
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(fromAddress);
            message.setTo(to);
            message.setSubject("Sign in to VFR Route");
            message.setText("Click to sign in (expires in 15 minutes):\n\n" + verifyUrl);
            mailSender.send(message);
        } catch (Exception e) {
            // An unreachable or unconfigured mail server (MAIL_HOST
            // unset, see application.yml) is a real, expected state in
            // this app, not a bug -- logged, not thrown, so it never
            // turns "sign in" itself into a 500 for the pilot who asked
            // for the link, the same fail-closed-but-not-loudly
            // philosophy Google's own unconfigured case already has.
            log.warn("Could not send magic-link email to {}", to, e);
        }
    }

    private String generateToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is a JDK-guaranteed algorithm (JCA baseline); this
            // cannot actually happen on any real JVM.
            throw new IllegalStateException(e);
        }
    }
}
