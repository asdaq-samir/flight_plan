package com.northflyers.vfr.security;

import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.UnverifiedEmailException;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/**
 * A Google or Apple sign-in, resolved to its pilot as it happens.
 *
 * <p>The provider's user is loaded as Spring Security loads it, then
 * found, adopted or created as a pilot -- once, here. An assertion that
 * cannot be a pilot -- an address the provider has not verified, or no
 * subject or email at all -- refuses the sign-in itself, and the browser
 * lands on the failure URL {@link SecurityConfig} gives. It used to be
 * let in and then refused on every later call: a session with no pilot,
 * 403 from each pilot-scoped endpoint (and a 500 from the developer check
 * for a missing claim), no way to sign out from the page, stuck until
 * the session expired -- with three places each knowing the rule.
 */
final class PilotOidcUserService implements OAuth2UserService<OidcUserRequest, OidcUser> {

    /** The OAuth2Error code a refused sign-in carries. */
    static final String REFUSED = "pilot_refused";

    private final PilotService pilots;
    private final OAuth2UserService<OidcUserRequest, OidcUser> provider;

    PilotOidcUserService(PilotService pilots) {
        this(pilots, new OidcUserService());
    }

    PilotOidcUserService(PilotService pilots, OAuth2UserService<OidcUserRequest, OidcUser> provider) {
        this.pilots = pilots;
        this.provider = provider;
    }

    @Override
    public OidcUser loadUser(OidcUserRequest request) {
        OidcUser user = provider.loadUser(request);
        try {
            pilots.fromOidcUser(user, request.getClientRegistration().getRegistrationId());
        } catch (UnverifiedEmailException | IllegalArgumentException refused) {
            throw new OAuth2AuthenticationException(new OAuth2Error(REFUSED, refused.getMessage(), null), refused);
        }
        return user;
    }
}
