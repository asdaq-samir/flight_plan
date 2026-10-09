package com.northflyers.vfr.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.UnverifiedEmailException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

/**
 * Sign in with Apple from the iOS app: a token Apple issued to this app
 * signs its pilot in on the session, as the web's Apple sign-in would;
 * anything else signs nobody in.
 */
class AppleNativeSignInControllerTest {

    private static Jwt token(String audience) {
        return Jwt.withTokenValue("apple-token").header("alg", "RS256")
                .issuer("https://appleid.apple.com").audience(List.of(audience)).subject("apple-sub-1")
                .claim("email", "pilot@example.com").claim("email_verified", "true")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(600)).build();
    }

    @Test
    void appleTokenForThisAppSignsItsPilotInOnTheSession() {
        PilotService pilots = mock(PilotService.class);
        given(pilots.fromOidcUser(any(OidcUser.class), eq("apple")))
                .willReturn(new Pilot("pilot@example.com", "A Pilot", null, "apple-sub-1"));
        JwtDecoder decoder = value -> token("app.wingtipmaps.ios");
        MockHttpServletRequest request = new MockHttpServletRequest();

        var answer = new AppleNativeSignInController(pilots, decoder).signIn(
                new AppleNativeSignInController.AppleToken("apple-token"), request, new MockHttpServletResponse());

        assertThat(answer.getStatusCode().value()).isEqualTo(200);
        SecurityContext context = (SecurityContext) request.getSession().getAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        OAuth2AuthenticationToken signedIn = (OAuth2AuthenticationToken) context.getAuthentication();
        assertThat(signedIn.getAuthorizedClientRegistrationId()).isEqualTo("apple");
        assertThat(signedIn.getName()).isEqualTo("apple-sub-1");
    }

    @Test
    void aTokenAppleDidNotIssueSignsNobodyIn() {
        JwtDecoder decoder = value -> {
            throw new BadJwtException("signature");
        };
        MockHttpServletRequest request = new MockHttpServletRequest();
        var answer = new AppleNativeSignInController(mock(PilotService.class), decoder).signIn(
                new AppleNativeSignInController.AppleToken("forged"), request, new MockHttpServletResponse());
        assertThat(answer.getStatusCode().value()).isEqualTo(401);
        assertThat(request.getSession(false)).isNull();
    }

    @Test
    void anUnverifiedAddressSignsNobodyIn() {
        PilotService pilots = mock(PilotService.class);
        given(pilots.fromOidcUser(any(OidcUser.class), eq("apple"))).willThrow(new UnverifiedEmailException("pilot@example.com"));
        var answer = new AppleNativeSignInController(pilots, value -> token("app.wingtipmaps.ios")).signIn(
                new AppleNativeSignInController.AppleToken("apple-token"), new MockHttpServletRequest(),
                new MockHttpServletResponse());
        assertThat(answer.getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void withNoAppThereIsNoNativeSignIn() {
        var answer = new AppleNativeSignInController(mock(PilotService.class), (JwtDecoder) null).signIn(
                new AppleNativeSignInController.AppleToken("apple-token"), new MockHttpServletRequest(),
                new MockHttpServletResponse());
        assertThat(answer.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void onlyThisAppsAudienceIsAccepted() {
        var validator = AppleNativeSignInController.forApp("app.wingtipmaps.ios");
        assertThat(validator.validate(token("app.wingtipmaps.ios")).hasErrors()).isFalse();
        assertThat(validator.validate(token("com.someone.else")).hasErrors()).isTrue();
    }
}
