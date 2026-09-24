package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.PilotRepository;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Sign-in's find-or-create, against a real database because the thing
 * being checked is how it behaves around a unique index.
 *
 * <p>The case that matters is the third one: a pilot whose email address
 * changes at the provider must keep their identity here. That is the
 * whole reason the subject is matched before the email, and it is the
 * kind of rule that reads as arbitrary until it is written down as a
 * failing alternative.
 */
@SpringBootTest
@Testcontainers
class PilotServiceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    @Autowired
    private PilotService pilotService;

    @Autowired
    private PilotRepository pilots;

    private static OAuth2User oidcUser(String subject, String email, String name) {
        return oidcUser(subject, email, name, true);
    }

    private static OAuth2User oidcUser(String subject, String email, String name, Object emailVerified) {
        OidcIdToken.Builder token = OidcIdToken.withTokenValue("token")
                .claim("sub", subject)
                .claim("email", email)
                .claim("name", name);
        if (emailVerified != null) {
            token.claim("email_verified", emailVerified);
        }
        return new DefaultOidcUser(java.util.List.of(), token.build());
    }

    /** An address the provider does not vouch for must not claim the
     *  pilot who owns it -- nor make one for its owner to sign into. */
    @Test
    void anUnverifiedAddressAdoptsNobodyAndCreatesNobody() {
        String email = UUID.randomUUID() + "@example.com";
        Pilot owner = pilotService.fromVerifiedEmail(email);

        assertThatThrownBy(() -> pilotService.fromOidcUser(oidcUser(UUID.randomUUID().toString(), email, "Mallory", false), "google"))
                .isInstanceOf(UnverifiedEmailException.class);
        assertThatThrownBy(() -> pilotService.fromOidcUser(oidcUser(UUID.randomUUID().toString(), UUID.randomUUID() + "@example.com", "M", null), "google"))
                .isInstanceOf(UnverifiedEmailException.class);
        assertThat(pilots.findById(owner.getId()).orElseThrow().getGoogleSubject()).isNull();
    }

    /** Apple sends the claim as a string. */
    @Test
    void applesStringClaimCounts() {
        String email = UUID.randomUUID() + "@example.com";
        Pilot pilot = pilotService.fromOidcUser(oidcUser(UUID.randomUUID().toString(), email, "A", "true"), "apple");
        assertThat(pilot.getEmail()).isEqualTo(email);
    }

    @Test
    void firstSignInCreatesThePilot() {
        String subject = UUID.randomUUID().toString();
        String email = subject + "@example.com";

        Pilot pilot = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"), "google");

        assertThat(pilot.getId()).isNotNull();
        assertThat(pilot.getEmail()).isEqualTo(email);
        assertThat(pilot.getDisplayName()).isEqualTo("A. Pilot");
        assertThat(pilot.getGoogleSubject()).isEqualTo(subject);
    }

    @Test
    void signingInAgainReturnsTheSamePilotRatherThanASecond() {
        String subject = UUID.randomUUID().toString();
        String email = subject + "@example.com";

        Pilot first = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"), "google");
        Pilot second = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"), "google");

        assertThat(second.getId()).isEqualTo(first.getId());
    }

    /**
     * The reason the subject is matched first. Changing an address at the
     * provider must not orphan a pilot from their flights.
     */
    @Test
    void aChangedEmailAddressKeepsTheSamePilot() {
        String subject = UUID.randomUUID().toString();
        Pilot before = pilotService.fromOidcUser(oidcUser(subject, subject + "@old.example.com", "A. Pilot"), "google");

        Pilot after = pilotService.fromOidcUser(oidcUser(subject, subject + "@new.example.com", "A. Pilot"), "google");

        assertThat(after.getId()).isEqualTo(before.getId());
    }

    /**
     * A record created before that person ever signed in is adopted, and
     * the subject written onto it, rather than duplicated.
     */
    @Test
    void anExistingPilotWithoutASubjectIsAdoptedOnFirstSignIn() {
        String email = UUID.randomUUID() + "@example.com";
        Pilot preexisting = pilots.save(new Pilot(email, "A. Pilot", null));
        String subject = UUID.randomUUID().toString();

        Pilot signedIn = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"), "google");

        assertThat(signedIn.getId()).isEqualTo(preexisting.getId());
        assertThat(pilots.findById(preexisting.getId()).orElseThrow().getGoogleSubject()).isEqualTo(subject);
    }

    @Test
    void theDisplayNameFallsBackToTheEmailWhenTheProviderSendsNone() {
        String subject = UUID.randomUUID().toString();
        String email = subject + "@example.com";

        Pilot pilot = pilotService.fromOidcUser(oidcUser(subject, email, null), "google");

        assertThat(pilot.getDisplayName()).isEqualTo(email);
    }

    @Test
    void anAssertionWithoutASubjectIsRejectedRatherThanTreatedAsANewPilot() {
        assertThatThrownBy(() -> pilotService.fromOidcUser(
                new org.springframework.security.oauth2.core.user.DefaultOAuth2User(
                        java.util.List.of(), Map.of("email", "nobody@example.com"), "email"),
                "google"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /**
     * Apple gets its own subject column -- a Google sub and an Apple sub
     * for the same person are unrelated strings, so signing in with each
     * must not collide or overwrite the other.
     */
    @Test
    void appleSignInWritesTheAppleSubjectColumnNotGoogles() {
        String subject = UUID.randomUUID().toString();
        String email = subject + "@example.com";

        Pilot pilot = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"), "apple");

        assertThat(pilot.getAppleSubject()).isEqualTo(subject);
        assertThat(pilot.getGoogleSubject()).isNull();
    }

    @Test
    void googleAndAppleSignInsForTheSameEmailShareOnePilot() {
        String email = UUID.randomUUID() + "@example.com";
        String googleSubject = UUID.randomUUID().toString();
        String appleSubject = UUID.randomUUID().toString();

        Pilot viaGoogle = pilotService.fromOidcUser(oidcUser(googleSubject, email, "A. Pilot"), "google");
        Pilot viaApple = pilotService.fromOidcUser(oidcUser(appleSubject, email, "A. Pilot"), "apple");

        assertThat(viaApple.getId()).isEqualTo(viaGoogle.getId());
        assertThat(pilots.findById(viaGoogle.getId()).orElseThrow().getAppleSubject()).isEqualTo(appleSubject);
    }

    /**
     * The magic-link flow's own find-or-create -- no subject at all,
     * email is already the strongest thing it can match on.
     */
    @Test
    void verifiedEmailCreatesAPilotOnFirstUse() {
        String email = UUID.randomUUID() + "@example.com";

        Pilot pilot = pilotService.fromVerifiedEmail(email);

        assertThat(pilot.getId()).isNotNull();
        assertThat(pilot.getEmail()).isEqualTo(email);
        assertThat(pilot.getDisplayName()).isEqualTo(email);
    }

    @Test
    void verifiedEmailReturnsTheExistingPilotRatherThanASecond() {
        String email = UUID.randomUUID() + "@example.com";
        Pilot preexisting = pilots.save(new Pilot(email, "A. Pilot", null));

        Pilot signedIn = pilotService.fromVerifiedEmail(email);

        assertThat(signedIn.getId()).isEqualTo(preexisting.getId());
    }
}
