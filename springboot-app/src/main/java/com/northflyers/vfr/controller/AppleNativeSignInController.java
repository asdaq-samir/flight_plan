package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.ErrorResponse;
import com.northflyers.vfr.security.SignInLanding;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.UnverifiedEmailException;
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
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionFixationProtectionStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sign in with Apple from the iOS app (web/ios), the native way: the
 * app's Apple sheet hands the page an identity token, and this checks
 * it -- Apple's signature (its published keys), Apple as the issuer, this
 * app's bundle id as the audience, not expired -- and signs the pilot in
 * on this session, as the web's own Apple sign-in does (the same pilot,
 * found by Apple's subject, PilotService.fromOidcUser). The web view
 * cannot use the web flow: Apple's page does not load inside an app's
 * app-bound web view, and App Review expects the native sheet.
 *
 * <p>A token is also tied to one sign-in attempt, as the web flow's
 * OIDC nonce does: the page asks for a nonce first (kept on the session,
 * good for one try), has the Apple sheet put its SHA-256 in the token
 * (Apple's own advice, Sign in with Apple "Authenticating users with
 * Sign in with Apple"), and the token is accepted only with that hash. A
 * token copied from a log or the bridge was made for another attempt and
 * is refused.
 *
 * <p>Without APP_IOS_BUNDLE_ID there is no app whose tokens to accept,
 * and this answers 404.
 */
@RestController
@RequestMapping("/api/auth/apple/native")
public class AppleNativeSignInController {

    static final String APPLE = "https://appleid.apple.com";
    static final String NONCE = AppleNativeSignInController.class.getName() + ".NONCE";

    private final SecureRandom random = new SecureRandom();

    private final PilotService pilots;
    private final JwtDecoder decoder;
    private final SecurityContextRepository securityContextRepository = new HttpSessionSecurityContextRepository();
    // As MagicLinkController: the session a pilot arrives with is not the
    // one they are signed in on.
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy = new SessionFixationProtectionStrategy();

    @Autowired
    public AppleNativeSignInController(PilotService pilots, @Value("${APP_IOS_BUNDLE_ID:}") String bundleId) {
        this(pilots, bundleId.isBlank() ? null : appleTokens(bundleId.trim()));
    }

    AppleNativeSignInController(PilotService pilots, JwtDecoder decoder) {
        this.pilots = pilots;
        this.decoder = decoder;
    }

    /** Apple's identity tokens for this app alone. */
    static JwtDecoder appleTokens(String bundleId) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(APPLE + "/auth/keys").build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(APPLE), forApp(bundleId)));
        return decoder;
    }

    /** A token issued to this app (its bundle id the audience), not to
     *  another app or to the web's own Services ID. */
    static OAuth2TokenValidator<Jwt> forApp(String bundleId) {
        return jwt -> jwt.getAudience() != null && jwt.getAudience().contains(bundleId)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "not this app's token", null));
    }

    /** What the app's Apple sheet answered. */
    public record AppleToken(@NotBlank @Size(max = 8000) String identityToken) {}

    /** The nonce for one sign-in attempt, as the page gives it to the sheet. */
    public record Nonce(String nonce) {}

    /** Signed in: where the app goes next (SignInLanding). */
    public record SignedIn(String next) {}

    @Operation(summary = "A one-time nonce for the iOS app's Apple sheet",
            description = "Kept on the session for the next native sign-in only; the page gives the sheet its SHA-256 "
                    + "(lowercase hex). 404 where no iOS app is set up.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "The nonce to hash for the sheet",
                content = @Content(schema = @Schema(implementation = Nonce.class))),
        @ApiResponse(responseCode = "404", description = "No iOS app set up here")
    })
    @GetMapping("/nonce")
    public ResponseEntity<?> nonce(HttpServletRequest request) {
        if (decoder == null) {
            return ResponseEntity.status(404).body(new ErrorResponse("Sign in with Apple is not set up for the app here."));
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        request.getSession().setAttribute(NONCE, nonce);
        return ResponseEntity.ok(new Nonce(nonce));
    }

    /** SHA-256 of the nonce, lowercase hex: what the sheet puts in the token. */
    static String hashed(String nonce) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(nonce.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @Operation(summary = "Sign in with Apple from the iOS app",
            description = "Checks the native sheet's identity token (Apple's keys, issuer, this app's bundle id, the nonce "
                    + "from /nonce) and "
                    + "signs the pilot in on this session. 404 where no iOS app is set up.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Signed in; `next` is where to go",
                content = @Content(schema = @Schema(implementation = SignedIn.class))),
        @ApiResponse(responseCode = "401", description = "Not a token Apple issued to this app, or no verified email"),
        @ApiResponse(responseCode = "404", description = "No iOS app set up here")
    })
    @PostMapping
    public ResponseEntity<?> signIn(@Valid @RequestBody AppleToken body, HttpServletRequest request,
            HttpServletResponse response) {
        if (decoder == null) {
            return ResponseEntity.status(404).body(new ErrorResponse("Sign in with Apple is not set up for the app here."));
        }
        Jwt jwt;
        try {
            jwt = decoder.decode(body.identityToken());
        } catch (JwtException refused) {
            return ResponseEntity.status(401).body(new ErrorResponse("Apple's sign-in could not be confirmed. Try again."));
        }
        OidcUser user = new DefaultOidcUser(List.of(new SimpleGrantedAuthority("OIDC_USER")),
                new OidcIdToken(jwt.getTokenValue(), jwt.getIssuedAt(), jwt.getExpiresAt(), jwt.getClaims()), "sub");
        // One try per nonce, spent whatever the answer.
        var session = request.getSession(false);
        Object issued = session == null ? null : session.getAttribute(NONCE);
        if (session != null) {
            session.removeAttribute(NONCE);
        }
        if (!(issued instanceof String nonce) || !hashed(nonce).equals(jwt.getClaimAsString("nonce"))) {
            return ResponseEntity.status(401).body(new ErrorResponse("Apple's sign-in could not be confirmed. Try again."));
        }
        Pilot pilot;
        try {
            pilot = pilots.fromOidcUser(user, "apple");
        } catch (UnverifiedEmailException | IllegalArgumentException refused) {
            return ResponseEntity.status(401).body(new ErrorResponse(
                    "Apple did not share a verified email address, which an account here needs."));
        }
        Authentication authentication = new OAuth2AuthenticationToken(user, user.getAuthorities(), "apple");
        sessionAuthenticationStrategy.onAuthentication(authentication, request, response);
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, request, response);
        return ResponseEntity.ok(new SignedIn(SignInLanding.after(pilot)));
    }
}
