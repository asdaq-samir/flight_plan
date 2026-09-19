package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.MagicLink;
import com.northflyers.vfr.dto.MagicLinkRequest;
import com.northflyers.vfr.repository.MagicLinkRepository;
import com.northflyers.vfr.security.MagicLinkAuthenticationToken;
import com.northflyers.vfr.service.PilotService;
import io.swagger.v3.oas.annotations.Operation;
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
import java.util.HexFormat;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

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

    private final MagicLinkRepository magicLinks;
    private final PilotService pilots;
    private final JavaMailSender mailSender;
    private final String fromAddress;
    private final SecureRandom random = new SecureRandom();
    private final SecurityContextRepository securityContextRepository = new HttpSessionSecurityContextRepository();

    public MagicLinkController(MagicLinkRepository magicLinks, PilotService pilots, JavaMailSender mailSender,
            @Value("${MAIL_FROM:no-reply@northflyers.com}") String fromAddress) {
        this.magicLinks = magicLinks;
        this.pilots = pilots;
        this.mailSender = mailSender;
        this.fromAddress = fromAddress;
    }

    @Operation(summary = "Start a magic-link sign-in",
            description = "Always 202 -- the response never reveals whether the address has signed in before.")
    @PostMapping
    public ResponseEntity<Void> request(@Valid @RequestBody MagicLinkRequest body, HttpServletRequest request) {
        String rawToken = generateToken();
        // Only the hash is stored -- see MagicLink's own javadoc. The
        // raw token exists only in this method's own stack and in the
        // email it's about to go out in.
        magicLinks.save(new MagicLink(body.email(), hash(rawToken), Instant.now().plus(TOKEN_LIFETIME)));
        String verifyUrl = ServletUriComponentsBuilder.fromRequestUri(request)
                .replacePath("/api/auth/magic-link/verify")
                .replaceQuery("token=" + rawToken)
                .build().toUriString();
        sendEmail(body.email(), verifyUrl);
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }

    @Operation(summary = "Sign in from a magic link",
            description = "302 to Settings, now signed in, on success; 400 for an expired, already-used or unrecognized token.")
    @GetMapping("/verify")
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
                    .body("This link has expired or was already used. Request a new one from Settings.");
        }
        MagicLink link = magicLinks.findByTokenHash(tokenHash).orElseThrow();
        var pilot = pilots.fromVerifiedEmail(link.getEmail());
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new MagicLinkAuthenticationToken(pilot.getEmail()));
        SecurityContextHolder.setContext(context);
        // Explicit save, not just setContext above -- outside Spring
        // Security's own filter chain (there is no
        // AuthenticationSuccessHandler here, this endpoint *is* the
        // success handler), nothing else persists the context into the
        // session for the next request.
        securityContextRepository.saveContext(context, request, response);
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create("/app/settings"))
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
