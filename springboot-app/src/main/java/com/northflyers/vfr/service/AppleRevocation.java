package com.northflyers.vfr.service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.stereotype.Service;

/**
 * Ends the grant Apple gave this app for a pilot, as their account goes:
 * App Review's 5.1.1(v) expects an app that offers Sign in with Apple to
 * call Apple's token revocation (POST /auth/revoke, with the Services ID,
 * the signed client secret and the refresh token) when the account is
 * deleted. Apple hands the server a refresh token at every sign-in, so the
 * token is kept (Pilot.appleRefreshToken) for this.
 *
 * <p>Best effort: the account is deleted whatever Apple answers, since a
 * token Apple no longer knows (already revoked) must not make the account
 * undeletable. A failure is logged.
 */
@Service
public class AppleRevocation {

    private static final Logger log = LoggerFactory.getLogger(AppleRevocation.class);

    private final Optional<ClientRegistrationRepository> registrations;
    private final String revokeUrl;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public AppleRevocation(Optional<ClientRegistrationRepository> registrations,
            @Value("${apple.revoke-url:https://appleid.apple.com/auth/revoke}") String revokeUrl) {
        this.registrations = registrations;
        this.revokeUrl = revokeUrl;
    }

    /** Revokes the refresh token; nothing to do for a pilot without one. */
    public void revoke(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            return;
        }
        ClientRegistration apple = registrations.map(r -> r.findByRegistrationId("apple")).orElse(null);
        if (apple == null) {
            log.warn("A pilot's Apple token was kept but Sign in with Apple is not configured; not revoked");
            return;
        }
        String body = "client_id=" + encode(apple.getClientId())
                + "&client_secret=" + encode(apple.getClientSecret())
                + "&token=" + encode(refreshToken)
                + "&token_type_hint=refresh_token";
        HttpRequest request = HttpRequest.newBuilder(URI.create(revokeUrl))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        try {
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() != 200) {
                log.error("Apple answered {} to revoking a deleted pilot's token", response.statusCode());
            }
        } catch (IOException failed) {
            log.error("Apple could not be reached to revoke a deleted pilot's token", failed);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            log.error("Interrupted revoking a deleted pilot's Apple token", interrupted);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
