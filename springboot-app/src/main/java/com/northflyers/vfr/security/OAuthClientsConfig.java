package com.northflyers.vfr.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.IdTokenClaimNames;
import org.springframework.util.StringUtils;

/**
 * Builds the OIDC client registrations sign-in actually uses -- Google
 * and Apple, whichever of the two have real credentials, as one
 * {@link ClientRegistrationRepository} bean rather than relying on
 * {@code spring.security.oauth2.client.registration.*} properties (the
 * declarative path Spring Boot's own auto-configuration reads). Google
 * would work declaratively; Apple cannot, which is the whole reason this
 * class exists at all.
 *
 * <p>{@code @Profile("oauth")}, same as the properties this used to
 * read from {@code application-oauth.yml}'s registration block did --
 * activation is still {@code SPRING_PROFILES_ACTIVE=oauth} plus real
 * credentials, just implemented in Java now instead of split across a
 * YAML file that could not express Apple's own client secret anyway.
 *
 * <p>Apple's client secret is not a fixed string the way Google's is --
 * it is a signed JWT (ES256, issued by the app itself) with a maximum
 * lifetime of six months, built here once at startup from four values
 * only Apple's own developer portal can produce ({@code APPLE_TEAM_ID},
 * {@code APPLE_KEY_ID}, {@code APPLE_SERVICES_ID} and the {@code .p8}
 * private key text), not minted or refreshed on a schedule -- a restart
 * well inside six months is what keeps it valid, which every deploy
 * already is. Apple has no userinfo endpoint at all, unlike Google;
 * {@code sub}/{@code email} come from the ID token directly, which is
 * all {@link com.northflyers.vfr.service.PilotService} reads regardless
 * of which provider asserted them.
 */
@Configuration
@Profile("oauth")
public class OAuthClientsConfig {

    private final String googleClientId;
    private final String googleClientSecret;
    private final String appleTeamId;
    private final String appleKeyId;
    private final String appleServicesId;
    private final String applePrivateKeyPem;

    OAuthClientsConfig(
            @Value("${GOOGLE_CLIENT_ID:}") String googleClientId,
            @Value("${GOOGLE_CLIENT_SECRET:}") String googleClientSecret,
            @Value("${APPLE_TEAM_ID:}") String appleTeamId,
            @Value("${APPLE_KEY_ID:}") String appleKeyId,
            @Value("${APPLE_SERVICES_ID:}") String appleServicesId,
            @Value("${APPLE_PRIVATE_KEY:}") String applePrivateKeyPem) {
        this.googleClientId = googleClientId;
        this.googleClientSecret = googleClientSecret;
        this.appleTeamId = appleTeamId;
        this.appleKeyId = appleKeyId;
        this.appleServicesId = appleServicesId;
        this.applePrivateKeyPem = applePrivateKeyPem;
    }

    /**
     * Absent (no bean at all) when neither provider has real
     * credentials -- {@link SecurityConfig} reads this same
     * {@code Optional} to decide whether {@code oauth2Login()} is even
     * registered, the same fail-closed shape {@code googleConfigured}
     * used to check on its own.
     */
    @Bean
    ClientRegistrationRepository clientRegistrationRepository() {
        List<ClientRegistration> registrations = new ArrayList<>();
        if (StringUtils.hasText(googleClientId) && StringUtils.hasText(googleClientSecret)) {
            registrations.add(google());
        }
        if (StringUtils.hasText(appleTeamId) && StringUtils.hasText(appleKeyId)
                && StringUtils.hasText(appleServicesId) && StringUtils.hasText(applePrivateKeyPem)) {
            registrations.add(apple());
        }
        // An InMemoryClientRegistrationRepository with zero entries
        // still lets the app start, but /oauth2/authorization/{id}
        // would 404 for every id rather than the login button simply
        // not existing -- SecurityConfig's own oauth2Login() call is
        // what's actually conditional on this bean, via the Optional
        // it's injected with, so an empty list here is never reached in
        // practice; kept as a real (if unreachable) fallback rather
        // than throwing, since a config class failing to start is a
        // far worse failure mode than a registration nobody visits.
        return new InMemoryClientRegistrationRepository(registrations);
    }

    private ClientRegistration google() {
        return ClientRegistration.withRegistrationId("google")
                .clientId(googleClientId)
                .clientSecret(googleClientSecret)
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .scope("openid", "profile", "email")
                .authorizationUri("https://accounts.google.com/o/oauth2/v2/auth")
                .tokenUri("https://www.googleapis.com/oauth2/v4/token")
                .userInfoUri("https://www.googleapis.com/oauth2/v3/userinfo")
                .userNameAttributeName(IdTokenClaimNames.SUB)
                .jwkSetUri("https://www.googleapis.com/oauth2/v3/certs")
                .issuerUri("https://accounts.google.com")
                .clientName("Google")
                .build();
    }

    private ClientRegistration apple() {
        return ClientRegistration.withRegistrationId("apple")
                .clientId(appleServicesId)
                .clientSecret(appleClientSecretJwt())
                // Apple requires the secret in the token request's own
                // body, not an Authorization: Basic header.
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                // "name" is real but only ever arrives once, in the
                // initial authorization POST body rather than the ID
                // token -- see PilotService's own comment on the
                // resulting display-name fallback. Requesting the scope
                // anyway costs nothing and is what Apple's own docs
                // show for every other client.
                .scope("openid", "email", "name")
                .authorizationUri("https://appleid.apple.com/auth/authorize")
                .tokenUri("https://appleid.apple.com/auth/token")
                // No userInfoUri -- Apple has none. Spring's own
                // OidcUserService only calls one when it's configured,
                // and both sub/email Apple ever asserts already arrive
                // on the ID token itself.
                .jwkSetUri("https://appleid.apple.com/auth/keys")
                .userNameAttributeName(IdTokenClaimNames.SUB)
                .clientName("Apple")
                .build();
    }

    private String appleClientSecretJwt() {
        try {
            Instant now = Instant.now();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(appleTeamId)
                    .subject(appleServicesId)
                    .audience("https://appleid.apple.com")
                    .issueTime(Date.from(now))
                    // Comfortably inside Apple's own 6-month ceiling --
                    // this is signed once at startup, not refreshed on
                    // a schedule, so a value close to that ceiling
                    // would leave almost no margin for a deploy that
                    // runs long between restarts.
                    .expirationTime(Date.from(now.plus(150, ChronoUnit.DAYS)))
                    .build();
            SignedJWT jwt = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(appleKeyId).build(),
                    claims);
            jwt.sign(new ECDSASigner(parseApplePrivateKey()));
            return jwt.serialize();
        } catch (Exception e) {
            // A malformed APPLE_PRIVATE_KEY is a startup-time
            // configuration error, not a runtime one -- surfacing it
            // clearly (and failing the whole bean, not just silently
            // registering Apple with a broken secret) beats a sign-in
            // that only fails once someone actually clicks the button.
            throw new IllegalStateException("Could not sign Apple's client-secret JWT -- check APPLE_PRIVATE_KEY", e);
        }
    }

    private ECPrivateKey parseApplePrivateKey() throws NoSuchAlgorithmException, InvalidKeySpecException {
        String base64 = applePrivateKeyPem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(base64);
        return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(der));
    }
}
