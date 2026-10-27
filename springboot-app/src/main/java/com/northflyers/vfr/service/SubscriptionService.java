package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.PaidFeature;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.Subscription;
import com.northflyers.vfr.dto.SubscriptionDto;
import com.northflyers.vfr.dto.SubscriptionDto.State;
import com.northflyers.vfr.repository.SubscriptionRepository;
import com.northflyers.vfr.security.SignInOptions;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The one entitlement to the paid features ({@link PaidFeature}), kept
 * here and checked here on every paid call: the page's own idea of it is
 * only for showing. The planner is asked only through this app
 * (PlannerProxyController: it publishes no port of its own), so a call
 * refused here never reaches it.
 *
 * <p>A pilot has the paid features while their free month runs (once an
 * account, started by them), while paid time runs (a store's or the
 * website's, recorded by {@link #paid}), or always when they are given
 * them: a developer, or an address {@code app.subscription.comped-emails}
 * lists (an instructor, a tester). Each feature Claude writes is counted
 * against a monthly cap per pilot, so a heavy user of the mock oral --
 * Opus, cents a question -- cannot cost more than a subscription brings
 * in. A developer's own testing is not counted.
 *
 * <p>Where nobody can sign in and writes are open (app.open-writes: one's
 * own machine) there is no pilot to hold a subscription, and every paid
 * feature is open with the rest.
 *
 * <p>A deployment may sell no subscription at all ({@code
 * app.subscription.enabled} false), at the owner's ask for the proof of
 * concept ("no mention of it at all ... if it picks up, I will go that
 * route"): the debrief, which costs nothing a use, is then everyone's,
 * and the features Claude writes are whoever {@code app.claude-features}
 * says -- nobody, the developers, or every pilot signed in (the default,
 * at the owner's ask: "I can offer the AI features to users with an
 * account, no revenue"), each within the monthly caps, which keep what
 * one pilot can cost in Claude calls bounded.
 */
@Service
public class SubscriptionService {

    /** Why a paid call was refused: the status and the pilot's sentence. */
    public record Refusal(int status, String detail) {
    }

    /** Who has the features Claude writes where no subscription is sold. */
    public enum ClaudeFeatures { OFF, DEVELOPERS, EVERYONE }

    /** The trial is already started, or was once: once an account. */
    public static class TrialUsedException extends RuntimeException {
        public TrialUsedException() {
            super("Your free month has already been used.");
        }
    }

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMMM", Locale.US);

    private final SubscriptionRepository subscriptions;
    private final PilotService pilots;
    private final SignInOptions signIn;
    private final Clock clock;
    private final int trialDays;
    private final Map<PaidFeature, Integer> caps;
    private final Set<String> compedEmails;
    private final boolean sold;
    private final ClaudeFeatures claude;

    @Autowired
    public SubscriptionService(SubscriptionRepository subscriptions, PilotService pilots, SignInOptions signIn,
            @Value("${app.subscription.trial-days:30}") int trialDays,
            @Value("${app.subscription.caps.narrative:60}") int narrativeCap,
            @Value("${app.subscription.caps.checkpoint-notes:60}") int notesCap,
            @Value("${app.subscription.caps.oral:60}") int oralCap,
            @Value("${app.subscription.comped-emails:}") String compedEmails,
            @Value("${app.subscription.enabled:false}") boolean sold,
            @Value("${app.claude-features:EVERYONE}") ClaudeFeatures claude) {
        this(subscriptions, pilots, signIn, Clock.systemUTC(), trialDays,
                Map.of(PaidFeature.NARRATIVE, narrativeCap, PaidFeature.CHECKPOINT_NOTES, notesCap,
                        PaidFeature.ORAL, oralCap),
                compedEmails, sold, claude);
    }

    /** A deployment that sells the subscription, as the tests mostly ask about. */
    SubscriptionService(SubscriptionRepository subscriptions, PilotService pilots, SignInOptions signIn, Clock clock,
            int trialDays, Map<PaidFeature, Integer> caps, String compedEmails) {
        this(subscriptions, pilots, signIn, clock, trialDays, caps, compedEmails, true, ClaudeFeatures.EVERYONE);
    }

    SubscriptionService(SubscriptionRepository subscriptions, PilotService pilots, SignInOptions signIn, Clock clock,
            int trialDays, Map<PaidFeature, Integer> caps, String compedEmails, boolean sold, ClaudeFeatures claude) {
        this.subscriptions = subscriptions;
        this.pilots = pilots;
        this.signIn = signIn;
        this.clock = clock;
        this.trialDays = trialDays;
        this.caps = new EnumMap<>(caps);
        this.compedEmails = Typed.addresses(compedEmails);
        this.sold = sold;
        this.claude = claude;
    }

    /** Whether this deployment sells the subscription at all: where not,
     *  the page says nothing of it (SignInCapabilitiesController). */
    public boolean sold() {
        return sold;
    }

    /** The pilot's subscription, with this month's uses. */
    @Transactional(readOnly = true)
    public SubscriptionDto status(Pilot pilot) {
        Instant now = clock.instant();
        Optional<Subscription> held = subscriptions.findById(pilot.getId());
        State state = stateOf(pilot, held, now);
        Instant until = switch (state) {
            case SUBSCRIBED -> held.orElseThrow().getPaidUntil();
            case TRIAL -> held.orElseThrow().getTrialEndsAt();
            case FREE, COMPED -> null;
        };
        // Once an account, and for a pilot who has never paid: a store's
        // introductory offer is a new subscriber's too.
        boolean trialAvailable = held.map(s -> s.getTrialStartedAt() == null && s.getPaidUntil() == null).orElse(true);
        Map<String, Integer> used = usesThisMonth(pilot, now);
        List<SubscriptionDto.FeatureUse> uses = Arrays.stream(PaidFeature.values())
                .filter(PaidFeature::capped)
                .map(f -> new SubscriptionDto.FeatureUse(f, used.getOrDefault(f.name(), 0), caps.getOrDefault(f, 0)))
                .toList();
        boolean paid = state == State.SUBSCRIBED;
        return new SubscriptionDto(state, state != State.FREE, until, trialAvailable && state == State.FREE,
                trialDays, paid ? held.orElseThrow().getPlan() : null, paid ? held.orElseThrow().getStore() : null,
                uses);
    }

    /** The free month, from now: once an account, whenever the pilot
     *  starts it. Refused once started, even long after it ended. */
    @Transactional
    public SubscriptionDto startTrial(Pilot pilot) {
        Instant now = clock.instant();
        Subscription held = subscriptions.findById(pilot.getId()).orElseGet(() -> new Subscription(pilot.getId(), now));
        if (held.getTrialStartedAt() != null) {
            throw new TrialUsedException();
        }
        held.startTrial(now, now.plus(Duration.ofDays(trialDays)));
        subscriptions.save(held);
        return status(pilot);
    }

    /** Paid time, as a store's server notification or a grant records it. */
    @Transactional
    public void paid(Pilot pilot, Instant until, Subscription.Plan plan, Subscription.Store store, String storeRef) {
        Instant now = clock.instant();
        Subscription held = subscriptions.findById(pilot.getId()).orElseGet(() -> new Subscription(pilot.getId(), now));
        held.paid(until, plan, store, storeRef, now);
        subscriptions.save(held);
    }

    /**
     * Whether the caller may use {@code feature} now, counting the use
     * when they may: empty to go on, or the refusal to answer with -- a
     * 401 signed out, a 402 without the subscription, a 429 past the
     * month's cap.
     */
    @Transactional
    public Optional<Refusal> refusal(Authentication authentication, PaidFeature feature) {
        if (signIn.access() == SignInOptions.Access.OPEN) {
            return Optional.empty();
        }
        Optional<Pilot> current = pilots.current(authentication);
        if (current.isEmpty()) {
            return Optional.of(new Refusal(401, "Sign in for " + feature.object() + "."));
        }
        Pilot pilot = current.get();
        Instant now = clock.instant();
        if (!sold) {
            // No subscription here: the debrief is everyone's; what Claude
            // writes is whoever the deployment says, said as not offered
            // (404) rather than as something to buy.
            if (!feature.capped() || (pilot.getRole().isDeveloper() && claude != ClaudeFeatures.OFF)) {
                return Optional.empty();
            }
            if (claude != ClaudeFeatures.EVERYONE) {
                return Optional.of(new Refusal(404, feature.comes() + " later; it is not offered yet."));
            }
            return counted(pilot, feature, now);
        }
        Optional<Subscription> held = subscriptions.findById(pilot.getId());
        State state = stateOf(pilot, held, now);
        if (state == State.FREE) {
            return Optional.of(new Refusal(402, feature.comes() + " with the subscription" + whyFree(held)));
        }
        if (!feature.capped() || pilot.getRole().isDeveloper()) {
            return Optional.empty();
        }
        return counted(pilot, feature, now);
    }

    /** A use of a Claude-written feature, counted against the month's cap;
     *  past it, refused with when there are more. */
    private Optional<Refusal> counted(Pilot pilot, PaidFeature feature, Instant now) {
        int cap = caps.getOrDefault(feature, 0);
        int used = usesThisMonth(pilot, now).getOrDefault(feature.name(), 0);
        if (used >= cap) {
            LocalDate next = month(now).plusMonths(1);
            return Optional.of(new Refusal(429, "That is this month's " + cap + " " + feature.counted()
                    + ". More on " + DAY.format(next) + "."));
        }
        subscriptions.countUse(pilot.getId(), month(now), feature.name());
        return Optional.empty();
    }

    private State stateOf(Pilot pilot, Optional<Subscription> held, Instant now) {
        if (pilot.getRole().isDeveloper() || compedEmails.contains(pilot.getEmail().toLowerCase(Locale.ROOT))) {
            return State.COMPED;
        }
        if (held.map(s -> s.getPaidUntil() != null && s.getPaidUntil().isAfter(now)).orElse(false)) {
            return State.SUBSCRIBED;
        }
        if (held.map(s -> s.getTrialEndsAt() != null && s.getTrialEndsAt().isAfter(now)).orElse(false)) {
            return State.TRIAL;
        }
        return State.FREE;
    }

    /** The rest of the 402's sentence: what ended, or the free month on offer. */
    private static String whyFree(Optional<Subscription> held) {
        Subscription s = held.orElse(null);
        if (s != null && s.getPaidUntil() != null) {
            return ". Yours ended on " + DAY.format(s.getPaidUntil().atZone(ZoneOffset.UTC)) + ".";
        }
        if (s != null && s.getTrialEndsAt() != null) {
            return ". Your free month ended on " + DAY.format(s.getTrialEndsAt().atZone(ZoneOffset.UTC)) + ".";
        }
        return ", its first month free.";
    }

    private Map<String, Integer> usesThisMonth(Pilot pilot, Instant now) {
        Map<String, Integer> used = new HashMap<>();
        for (Object[] row : subscriptions.usesIn(pilot.getId(), month(now))) {
            used.put((String) row[0], ((Number) row[1]).intValue());
        }
        return used;
    }

    /** The month a moment falls in, by its first day, UTC. */
    private static LocalDate month(Instant now) {
        return LocalDate.ofInstant(now, ZoneOffset.UTC).withDayOfMonth(1);
    }
}
