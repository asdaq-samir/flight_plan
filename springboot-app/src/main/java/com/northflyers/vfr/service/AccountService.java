package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.MagicLinkRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Deleting a pilot's account, everything that was theirs with it --
 * App Review's 5.1.1(v): an app that lets an account be made lets it be
 * deleted, from inside the app.
 *
 * <p>In this order: first the checkpoint notes the pilot wrote for
 * themselves, which the planner keeps (its routers/notes.py), since the
 * planner may not answer; then, in one transaction, the pilot's row --
 * the database cascades it to their aircraft, flights, logbook and
 * endorsements -- and the sign-in links ever sent to their address; last
 * every session they hold, on any device, under any of the names they
 * sign in by. Only the planner being down leaves the account whole: the
 * notes cannot be given back, so a database failure after them leaves
 * the account without its notes, and once the transaction commits the
 * account is gone whatever happens to the sessions.
 */
@Service
public class AccountService {

    /** Who a note belongs to, as the planner reads it (PlannerProxyController's). */
    static final String PILOT_HEADER = "X-Pilot-Id";

    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    private final PilotRepository pilots;
    private final MagicLinkRepository magicLinks;
    private final FindByIndexNameSessionRepository<? extends Session> sessions;
    private final TransactionTemplate transaction;
    private final String plannerBaseUrl;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public AccountService(PilotRepository pilots, MagicLinkRepository magicLinks,
            FindByIndexNameSessionRepository<? extends Session> sessions, TransactionTemplate transaction,
            @Value("${planner-service.base-url:http://planning-service:8000}") String plannerBaseUrl) {
        this.pilots = pilots;
        this.magicLinks = magicLinks;
        this.sessions = sessions;
        this.transaction = transaction;
        this.plannerBaseUrl = plannerBaseUrl.replaceAll("/+$", "");
    }

    /**
     * Deletes the pilot and everything that was theirs.
     *
     * @throws AccountNotDeletedException when the planner cannot take the
     *     pilot's notes; nothing else has been deleted then
     */
    public void delete(Pilot pilot) {
        forgetNotes(pilot);
        transaction.executeWithoutResult(status -> {
            magicLinks.deleteByEmail(pilot.getEmail());
            pilots.deleteNow(pilot.getId());
        });
        // A magic link signs in under the address, Google and Apple under
        // their own subject: whichever this pilot used, on whatever device.
        Stream.of(pilot.getEmail(), pilot.getGoogleSubject(), pilot.getAppleSubject())
                .filter(name -> name != null && !name.isBlank())
                .forEach(this::endSessions);
    }

    /** The account is already gone, so a failure here must not turn the
     *  answer into an error: the browser would not clear this device. */
    private void endSessions(String name) {
        try {
            sessions.findByPrincipalName(name).keySet().forEach(sessions::deleteById);
        } catch (RuntimeException failed) {
            log.error("Account deleted but its sessions under {} could not all be ended", name, failed);
        }
    }

    private void forgetNotes(Pilot pilot) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(plannerBaseUrl + "/api/checkpoint-notes/mine"))
                .DELETE()
                .header(PILOT_HEADER, String.valueOf(pilot.getId()))
                .timeout(Duration.ofSeconds(15))
                .build();
        try {
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() != 200) {
                throw new AccountNotDeletedException("the planner answered " + response.statusCode());
            }
        } catch (IOException failed) {
            throw new AccountNotDeletedException("the planner could not be reached", failed);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AccountNotDeletedException("interrupted", interrupted);
        }
    }

    /** The account is untouched: the planner could not take the pilot's
     *  notes, and nothing is deleted until it can. */
    public static class AccountNotDeletedException extends RuntimeException {
        AccountNotDeletedException(String why) {
            super(why);
        }

        AccountNotDeletedException(String why, Throwable cause) {
            super(why, cause);
        }
    }
}
