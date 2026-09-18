package com.northflyers.vfr.security;

import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;

/**
 * The session's own authentication after a magic-link click -- there is
 * no OAuth2 exchange behind this one, so it is not an {@code OAuth2User}
 * the way a Google or Apple sign-in's principal is. Carries only the
 * address the link proved control of; {@link
 * com.northflyers.vfr.service.PilotService#current} resolves that into
 * the actual {@code Pilot} row the same way it resolves an OIDC
 * principal's {@code sub}/{@code email} claims.
 */
public class MagicLinkAuthenticationToken extends AbstractAuthenticationToken {

    private final String email;

    public MagicLinkAuthenticationToken(String email) {
        super(List.of());
        this.email = email;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return null;
    }

    @Override
    public Object getPrincipal() {
        return email;
    }
}
