package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.northflyers.vfr.domain.PaidFeature;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.Subscription;
import com.northflyers.vfr.dto.SubscriptionDto;
import com.northflyers.vfr.dto.SubscriptionDto.State;
import com.northflyers.vfr.repository.SubscriptionRepository;
import com.northflyers.vfr.security.MagicLinkAuthenticationToken;
import com.northflyers.vfr.security.SignInOptions;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.security.core.Authentication;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The one entitlement to the paid features, against a real database (the
 * month's uses are counted in one upsert): free, the free month started
 * once and run out, paid for and run out, given, and each Claude feature
 * capped by the month -- refused with 401, 402 or 429 as each is, and the
 * use counted only when it goes on.
 */
@SpringBootTest(properties = "app.developer-emails=dev@example.com")
@Testcontainers
class SubscriptionServiceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    /** A clock the test moves. */
    static final class Moving extends Clock {
        Instant now = Instant.parse("2026-10-11T12:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Autowired
    private SubscriptionRepository repository;

    @Autowired
    private PilotService pilots;

    private final Moving clock = new Moving();

    private SubscriptionService service(SignInOptions.Access access, String comped) {
        return new SubscriptionService(repository, pilots, new SignInOptions(List.of("email"), access), clock, 30,
                Map.of(PaidFeature.NARRATIVE, 2, PaidFeature.CHECKPOINT_NOTES, 60, PaidFeature.ORAL, 60), comped);
    }

    private SubscriptionService service() {
        return service(SignInOptions.Access.SIGN_IN, "instructor@example.com");
    }

    /** A new pilot, signed in by the emailed link. */
    private static Authentication someone() {
        return new MagicLinkAuthenticationToken(UUID.randomUUID() + "@example.com");
    }

    private Pilot pilotOf(Authentication who) {
        return pilots.current(who).orElseThrow();
    }

    @Test
    void aNewPilotHasNoneAndIsOfferedTheFreeMonth() {
        Authentication who = someone();
        SubscriptionDto status = service().status(pilotOf(who));
        assertThat(status.state()).isEqualTo(State.FREE);
        assertThat(status.entitled()).isFalse();
        assertThat(status.trialAvailable()).isTrue();
        assertThat(status.trialDays()).isEqualTo(30);
        assertThat(status.uses()).extracting(SubscriptionDto.FeatureUse::feature)
                .containsExactly(PaidFeature.NARRATIVE, PaidFeature.CHECKPOINT_NOTES, PaidFeature.ORAL);

        Optional<SubscriptionService.Refusal> refused = service().refusal(who, PaidFeature.NARRATIVE);
        assertThat(refused).hasValueSatisfying(r -> {
            assertThat(r.status()).isEqualTo(402);
            assertThat(r.detail()).isEqualTo("The written briefing comes with the subscription, its first month free.");
        });
    }

    @Test
    void theFreeMonthIsOnceAnAccountAndRunsOutAfterThirtyDays() {
        Authentication who = someone();
        Pilot pilot = pilotOf(who);
        SubscriptionDto started = service().startTrial(pilot);
        assertThat(started.state()).isEqualTo(State.TRIAL);
        assertThat(started.entitled()).isTrue();
        assertThat(started.trialAvailable()).isFalse();
        assertThat(started.until()).isEqualTo(Instant.parse("2026-11-10T12:00:00Z"));
        assertThat(service().refusal(who, PaidFeature.NARRATIVE)).isEmpty();
        assertThatThrownBy(() -> service().startTrial(pilot)).isInstanceOf(SubscriptionService.TrialUsedException.class);

        clock.now = clock.now.plus(Duration.ofDays(31));
        SubscriptionDto ended = service().status(pilot);
        assertThat(ended.state()).isEqualTo(State.FREE);
        assertThat(ended.trialAvailable()).isFalse();
        assertThat(service().refusal(who, PaidFeature.CHECKPOINT_NOTES)).hasValueSatisfying(r -> {
            assertThat(r.status()).isEqualTo(402);
            assertThat(r.detail()).isEqualTo("Checkpoint descriptions come with the subscription. Your free month ended on 10 November.");
        });
        // Still once an account, long after.
        assertThatThrownBy(() -> service().startTrial(pilot)).isInstanceOf(SubscriptionService.TrialUsedException.class);
    }

    @Test
    void paidTimeIsTheirsUntilItRunsOut() {
        Authentication who = someone();
        Pilot pilot = pilotOf(who);
        service().paid(pilot, Instant.parse("2027-10-11T12:00:00Z"), Subscription.Plan.YEARLY,
                Subscription.Store.APP_STORE, "2000000123456789");
        SubscriptionDto paid = service().status(pilot);
        assertThat(paid.state()).isEqualTo(State.SUBSCRIBED);
        assertThat(paid.plan()).isEqualTo(Subscription.Plan.YEARLY);
        assertThat(paid.store()).isEqualTo(Subscription.Store.APP_STORE);
        assertThat(paid.until()).isEqualTo(Instant.parse("2027-10-11T12:00:00Z"));
        assertThat(paid.trialAvailable()).isFalse();
        assertThat(service().refusal(who, PaidFeature.DEBRIEF)).isEmpty();

        clock.now = Instant.parse("2027-10-12T00:00:00Z");
        SubscriptionDto lapsed = service().status(pilot);
        assertThat(lapsed.state()).isEqualTo(State.FREE);
        // The free month is a new subscriber's, as a store's introductory offer is.
        assertThat(lapsed.trialAvailable()).isFalse();
        assertThat(service().refusal(who, PaidFeature.DEBRIEF)).hasValueSatisfying(r -> {
            assertThat(r.status()).isEqualTo(402);
            assertThat(r.detail()).isEqualTo("The debrief comes with the subscription. Yours ended on 11 October.");
        });
    }

    @Test
    void eachClaudeFeatureIsCappedByTheMonthAndCountedOnlyWhenItGoesOn() {
        Authentication who = someone();
        Pilot pilot = pilotOf(who);
        service().startTrial(pilot);
        assertThat(service().refusal(who, PaidFeature.NARRATIVE)).isEmpty();
        assertThat(service().refusal(who, PaidFeature.NARRATIVE)).isEmpty();
        assertThat(service().refusal(who, PaidFeature.NARRATIVE)).hasValueSatisfying(r -> {
            assertThat(r.status()).isEqualTo(429);
            assertThat(r.detail()).isEqualTo("That is this month's 2 written briefings. More on 1 November.");
        });
        // The refusal was not counted, and the other features are their own.
        assertThat(service().status(pilot).uses()).contains(
                new SubscriptionDto.FeatureUse(PaidFeature.NARRATIVE, 2, 2),
                new SubscriptionDto.FeatureUse(PaidFeature.CHECKPOINT_NOTES, 0, 60));
        assertThat(service().refusal(who, PaidFeature.CHECKPOINT_NOTES)).isEmpty();

        // A new month, a new allowance.
        clock.now = Instant.parse("2026-11-01T00:00:00Z");
        assertThat(service().refusal(who, PaidFeature.NARRATIVE)).isEmpty();
        assertThat(service().status(pilot).uses()).contains(new SubscriptionDto.FeatureUse(PaidFeature.NARRATIVE, 1, 2));
    }

    @Test
    void anInstructorGivenItIsCountedAndADeveloperIsNot() {
        Authentication instructor = new MagicLinkAuthenticationToken("Instructor@Example.com");
        SubscriptionDto given = service().status(pilotOf(instructor));
        assertThat(given.state()).isEqualTo(State.COMPED);
        assertThat(given.entitled()).isTrue();
        assertThat(given.until()).isNull();
        service().refusal(instructor, PaidFeature.NARRATIVE);
        service().refusal(instructor, PaidFeature.NARRATIVE);
        assertThat(service().refusal(instructor, PaidFeature.NARRATIVE)).map(SubscriptionService.Refusal::status).hasValue(429);

        Authentication developer = new MagicLinkAuthenticationToken("dev@example.com");
        for (int i = 0; i < 5; i++) {
            assertThat(service().refusal(developer, PaidFeature.NARRATIVE)).isEmpty();
        }
        assertThat(service().status(pilotOf(developer)).state()).isEqualTo(State.COMPED);
    }

    @Test
    void signedOutIsA401AndAMachineOfOnesOwnHasItAll() {
        assertThat(service().refusal(null, PaidFeature.ORAL)).hasValueSatisfying(r -> {
            assertThat(r.status()).isEqualTo(401);
            assertThat(r.detail()).isEqualTo("Sign in for the mock oral.");
        });
        assertThat(service(SignInOptions.Access.OPEN, "").refusal(null, PaidFeature.ORAL)).isEmpty();
    }
}
