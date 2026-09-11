package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.PilotRepository;
import java.util.Optional;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * Turns a Google identity into the {@link Pilot} it belongs to.
 *
 * <p>The matching order is the whole of the interesting logic here.
 * Google's {@code sub} claim is tried first because it is stable for the
 * life of the account; email is tried only as a fallback, to adopt a
 * record created before that person ever signed in, and the subject is
 * written onto it when that happens so the fallback is never needed
 * again.
 *
 * <p>Doing it the other way round -- matching email first -- looks
 * equivalent and is not. An address can be changed by its owner and
 * reassigned by a workspace administrator, so email-first either loses a
 * pilot their flights when they rename, or hands them someone else's.
 */
@Service
public class PilotService {

    private final PilotRepository pilots;

    public PilotService(PilotRepository pilots) {
        this.pilots = pilots;
    }

    /**
     * The signed-in pilot, created on first sign-in if they are new.
     *
     * @throws IllegalArgumentException if the provider returned no subject
     *     or no email, which is a broken assertion rather than a new user
     */
    @Transactional
    public Pilot fromOidcUser(OAuth2User user) {
        String subject = user.getAttribute("sub");
        String email = user.getAttribute("email");
        if (!StringUtils.hasText(subject) || !StringUtils.hasText(email)) {
            throw new IllegalArgumentException("OIDC assertion carried no subject or no email");
        }
        String name = Optional.<String>ofNullable(user.getAttribute("name")).orElse(email);

        Optional<Pilot> bySubject = pilots.findByGoogleSubject(subject);
        if (bySubject.isPresent()) {
            return bySubject.get();
        }

        Optional<Pilot> byEmail = pilots.findByEmail(email);
        if (byEmail.isPresent()) {
            // Adopt the pre-existing record rather than creating a second
            // pilot with the same address, which the unique index would
            // reject anyway.
            Pilot pilot = byEmail.get();
            pilot.linkGoogleSubject(subject);
            return pilots.save(pilot);
        }

        return pilots.save(new Pilot(email, name, subject));
    }

    /**
     * The pilot for the current request, or empty when nobody is signed
     * in or the principal is not an OIDC user.
     */
    @Transactional
    public Optional<Pilot> current(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof OAuth2User user)) {
            return Optional.empty();
        }
        return Optional.of(fromOidcUser(user));
    }
}
