package com.northflyers.vfr.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.UnverifiedEmailException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUserAuthority;

/**
 * An OIDC sign-in is resolved to its pilot as it happens, and one that
 * cannot be a pilot is refused there -- not let in and refused on every
 * later call. The provider's own user-loading is stubbed.
 */
class PilotOidcUserServiceTest {

    private final PilotService pilots = mock(PilotService.class);

    private static OidcUser user(Map<String, Object> claims) {
        OidcIdToken token = new OidcIdToken("token", Instant.now(), Instant.now().plusSeconds(60), claims);
        return new DefaultOidcUser(List.of(new OidcUserAuthority(token)), token);
    }

    private static OidcUserRequest request() {
        ClientRegistration google = ClientRegistration.withRegistrationId("google")
                .clientId("id").authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .authorizationUri("https://accounts.example/auth").tokenUri("https://accounts.example/token")
                .build();
        OAuth2AccessToken access = new OAuth2AccessToken(
                OAuth2AccessToken.TokenType.BEARER, "access", Instant.now(), Instant.now().plusSeconds(60));
        OidcIdToken id = new OidcIdToken("token", Instant.now(), Instant.now().plusSeconds(60), Map.of("sub", "sub-1"));
        return new OidcUserRequest(google, access, id);
    }

    @Test
    void aVerifiedSignInIsResolvedToItsPilotOnce() {
        OidcUser loaded = user(Map.of("sub", "sub-1", "email", "pilot@example.com", "email_verified", true));
        given(pilots.fromOidcUser(any(), eq("google"))).willReturn(new Pilot("pilot@example.com", "A Pilot", "sub-1"));

        OidcUser signedIn = new PilotOidcUserService(pilots, r -> loaded).loadUser(request());

        assertThat(signedIn).isSameAs(loaded);
        verify(pilots).fromOidcUser(loaded, "google");
    }

    @Test
    void anUnverifiedAddressRefusesTheSignInItself() {
        OidcUser loaded = user(Map.of("sub", "sub-1", "email", "someone@example.com", "email_verified", false));
        given(pilots.fromOidcUser(any(), any())).willThrow(new UnverifiedEmailException("someone@example.com"));

        assertThatThrownBy(() -> new PilotOidcUserService(pilots, r -> loaded).loadUser(request()))
                .isInstanceOf(OAuth2AuthenticationException.class)
                .satisfies(e -> assertThat(((OAuth2AuthenticationException) e).getError().getErrorCode())
                        .isEqualTo(PilotOidcUserService.REFUSED));
    }

    @Test
    void anAssertionWithNoEmailIsARefusedSignInNotA500() {
        OidcUser loaded = user(Map.of("sub", "sub-1"));
        given(pilots.fromOidcUser(any(), any())).willThrow(new IllegalArgumentException("no email"));

        assertThatThrownBy(() -> new PilotOidcUserService(pilots, r -> loaded).loadUser(request()))
                .isInstanceOf(OAuth2AuthenticationException.class);
    }
}
