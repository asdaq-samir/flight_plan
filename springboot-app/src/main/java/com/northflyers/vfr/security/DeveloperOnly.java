package com.northflyers.vfr.security;

import com.northflyers.vfr.service.PilotService;
import java.util.function.Supplier;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

/**
 * Whether the caller holds {@link com.northflyers.vfr.domain.PilotRole#DEVELOPER}.
 *
 * <p>Asked of the pilot's own row on every request rather than stamped
 * into the session as an authority at sign-in. A developer is made (or
 * unmade) with an {@code UPDATE} on the pilots table (see the V7
 * migration), and this way that takes effect on the pilot's next request
 * instead of their next sign-in. The lookup is the same one every
 * pilot-scoped controller already makes through
 * {@link PilotService#current}.
 *
 * <p>A caller with no session is refused too, and Spring Security turns
 * that into the usual 401; a signed-in pilot without the role gets 403.
 */
final class DeveloperOnly implements AuthorizationManager<RequestAuthorizationContext> {

    private final PilotService pilots;

    DeveloperOnly(PilotService pilots) {
        this.pilots = pilots;
    }

    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication, RequestAuthorizationContext context) {
        boolean developer = pilots.current(authentication.get())
                .map(pilot -> pilot.getRole().isDeveloper())
                .orElse(false);
        return new AuthorizationDecision(developer);
    }
}
