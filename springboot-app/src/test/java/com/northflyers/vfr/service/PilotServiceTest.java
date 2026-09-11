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
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired
    private PilotService pilotService;

    @Autowired
    private PilotRepository pilots;

    private static OAuth2User oidcUser(String subject, String email, String name) {
        OidcIdToken token = OidcIdToken.withTokenValue("token")
                .claim("sub", subject)
                .claim("email", email)
                .claim("name", name)
                .build();
        return new DefaultOidcUser(java.util.List.of(), token);
    }

    @Test
    void firstSignInCreatesThePilot() {
        String subject = UUID.randomUUID().toString();
        String email = subject + "@example.com";

        Pilot pilot = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"));

        assertThat(pilot.getId()).isNotNull();
        assertThat(pilot.getEmail()).isEqualTo(email);
        assertThat(pilot.getDisplayName()).isEqualTo("A. Pilot");
    }

    @Test
    void signingInAgainReturnsTheSamePilotRatherThanASecond() {
        String subject = UUID.randomUUID().toString();
        String email = subject + "@example.com";

        Pilot first = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"));
        Pilot second = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"));

        assertThat(second.getId()).isEqualTo(first.getId());
    }

    /**
     * The reason the subject is matched first. Changing an address at the
     * provider must not orphan a pilot from their flights.
     */
    @Test
    void aChangedEmailAddressKeepsTheSamePilot() {
        String subject = UUID.randomUUID().toString();
        Pilot before = pilotService.fromOidcUser(oidcUser(subject, subject + "@old.example.com", "A. Pilot"));

        Pilot after = pilotService.fromOidcUser(oidcUser(subject, subject + "@new.example.com", "A. Pilot"));

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

        Pilot signedIn = pilotService.fromOidcUser(oidcUser(subject, email, "A. Pilot"));

        assertThat(signedIn.getId()).isEqualTo(preexisting.getId());
        assertThat(pilots.findById(preexisting.getId()).orElseThrow().getGoogleSubject()).isEqualTo(subject);
    }

    @Test
    void theDisplayNameFallsBackToTheEmailWhenTheProviderSendsNone() {
        String subject = UUID.randomUUID().toString();
        String email = subject + "@example.com";

        Pilot pilot = pilotService.fromOidcUser(oidcUser(subject, email, null));

        assertThat(pilot.getDisplayName()).isEqualTo(email);
    }

    @Test
    void anAssertionWithoutASubjectIsRejectedRatherThanTreatedAsANewPilot() {
        assertThatThrownBy(() -> pilotService.fromOidcUser(
                new org.springframework.security.oauth2.core.user.DefaultOAuth2User(
                        java.util.List.of(), Map.of("email", "nobody@example.com"), "email")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
