package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.PilotRepository;
import com.northflyers.vfr.security.MagicLinkAuthenticationToken;
import java.util.Optional;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * Turns whichever identity a sign-in actually proved -- a Google or
 * Apple OIDC assertion, or a magic link's verified email -- into the
 * {@link Pilot} it belongs to.
 *
 * <p>The matching order per OIDC provider is the whole of the
 * interesting logic here. Each provider's own {@code sub} claim is
 * tried first because it is stable for the life of that account; email
 * is tried only as a fallback, to adopt a record created before that
 * person ever signed in through this particular provider, and the
 * subject is written onto it when that happens so the fallback is never
 * needed again for it.
 *
 * <p>Doing it the other way round -- matching email first -- looks
 * equivalent and is not. An address can be changed by its owner and
 * reassigned by a workspace administrator, so email-first either loses a
 * pilot their flights when they rename, or hands them someone else's.
 * The magic-link flow has no subject of its own to prefer over email in
 * the first place -- proving control of an address is exactly what it
 * is, so email is already the strongest thing it can match on.
 */
@Service
public class PilotService {

    private final PilotRepository pilots;

    public PilotService(PilotRepository pilots) {
        this.pilots = pilots;
    }

    /**
     * The signed-in pilot for an OIDC provider, created on first sign-in
     * through it if they are new.
     *
     * @param registrationId which provider asserted this identity --
     *     "apple" matches/writes {@code appleSubject}, anything else
     *     (in practice just "google") matches/writes {@code
     *     googleSubject}, the only two OIDC providers this app
     *     registers.
     * @throws IllegalArgumentException if the provider returned no
     *     subject or no email, which is a broken assertion rather than
     *     a new user
     */
    @Transactional
    public Pilot fromOidcUser(OAuth2User user, String registrationId) {
        String subject = user.getAttribute("sub");
        String email = user.getAttribute("email");
        if (!StringUtils.hasText(subject) || !StringUtils.hasText(email)) {
            throw new IllegalArgumentException("OIDC assertion carried no subject or no email");
        }
        String name = Optional.<String>ofNullable(user.getAttribute("name")).orElse(email);
        boolean apple = "apple".equals(registrationId);

        Optional<Pilot> bySubject = apple ? pilots.findByAppleSubject(subject) : pilots.findByGoogleSubject(subject);
        if (bySubject.isPresent()) {
            return bySubject.get();
        }

        // Past this point the address is what identifies the pilot: an
        // existing pilot with it is adopted, or a new one is made with it
        // (and a later magic-link sign-in finds that one). So it must be
        // an address the provider says this person controls. Without the
        // check, an account at a provider that allows unverified
        // addresses could claim anyone's pilot -- a developer's included,
        // now that the role is enforced on the server -- or make one in
        // their name for its owner to sign into later.
        if (!emailVerified(user)) {
            throw new UnverifiedEmailException(email);
        }
        Optional<Pilot> byEmail = pilots.findByEmail(email);
        if (byEmail.isPresent()) {
            // Adopt the pre-existing record rather than creating a second
            // pilot with the same address, which the unique index would
            // reject anyway.
            Pilot pilot = byEmail.get();
            if (apple) {
                pilot.linkAppleSubject(subject);
            } else {
                pilot.linkGoogleSubject(subject);
            }
            return pilots.save(pilot);
        }

        return pilots.save(apple ? new Pilot(email, name, null, subject) : new Pilot(email, name, subject));
    }

    /**
     * The signed-in pilot for a verified email address (the magic-link
     * flow), created on first sign-in if they are new. No subject to
     * match or write -- proving control of the address is the whole of
     * what a magic link asserts, and email is already {@link Pilot}'s
     * own stable identity column.
     */
    /** Google sends `email_verified` as a boolean, Apple as the string
     *  "true"; anything else, or nothing, is unverified. */
    private static boolean emailVerified(OAuth2User user) {
        Object verified = user.getAttribute("email_verified");
        return Boolean.TRUE.equals(verified) || "true".equalsIgnoreCase(String.valueOf(verified));
    }

    @Transactional
    public Pilot fromVerifiedEmail(String email) {
        return pilots.findByEmail(email).orElseGet(() -> pilots.save(new Pilot(email, email, null)));
    }

    /**
     * The pilot for the current request, or empty when nobody is signed
     * in or the principal is a kind this app never issues.
     */
    @Transactional
    public Optional<Pilot> current(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return Optional.empty();
        }
        if (authentication instanceof OAuth2AuthenticationToken oauth
                && oauth.getPrincipal() instanceof OAuth2User user) {
            return Optional.of(fromOidcUser(user, oauth.getAuthorizedClientRegistrationId()));
        }
        if (authentication instanceof MagicLinkAuthenticationToken magicLink) {
            return Optional.of(fromVerifiedEmail((String) magicLink.getPrincipal()));
        }
        return Optional.empty();
    }
}
