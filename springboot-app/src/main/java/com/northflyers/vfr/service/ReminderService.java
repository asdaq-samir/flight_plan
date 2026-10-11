package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.CurrencyDto;
import com.northflyers.vfr.repository.LogbookRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Reminders by email before a pilot's currency runs out, for those who
 * asked: 30 days before and again 7 days before the flight review's last
 * day (14 CFR 61.56(c)), the medical's (61.23), passengers by day and at
 * night (61.57(a), (b)) and instrument currency (61.57(c)) -- each as the
 * Logbook works it out (CurrencyService). Every morning (14:00 UTC, the
 * contiguous U.S.'s morning) one email lists what is coming up; each
 * reminder is sent once, recorded with what it was of and its day, so a
 * day missed sends it the next and a day repeated sends nothing twice.
 * Where the email cannot be sent, nothing is recorded, and it is tried
 * again the next day.
 */
@Service
public class ReminderService {

    private static final Logger log = LoggerFactory.getLogger(ReminderService.class);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.US);

    /** A reminder due: what it is of, its words, its day, and which of
     *  the two it is (30 days before, or 7). */
    public record Reminder(String what, String words, LocalDate dueOn, int daysBefore) {
    }

    private final PilotRepository pilots;
    private final LogbookRepository logbook;
    private final CurrencyService currency;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final JavaMailSender mail;

    public ReminderService(PilotRepository pilots, LogbookRepository logbook, CurrencyService currency, JdbcTemplate jdbc,
                           TransactionTemplate transaction, JavaMailSender mail) {
        this.pilots = pilots;
        this.logbook = logbook;
        this.currency = currency;
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.mail = mail;
    }

    /** What is coming up within 30 days of `today`, each by the nearer of
     *  its two reminders: 7 days before from the seventh day on, else 30. */
    public static List<Reminder> due(CurrencyDto c, LocalDate today) {
        List<Reminder> out = new ArrayList<>();
        add(out, "flight-review", c.flightReviewUntil(), "Your flight review runs out", "14 CFR 61.56(c)", today);
        add(out, "medical", c.medicalExpiresOn(), "Your medical certificate runs out", "14 CFR 61.23", today);
        add(out, "day-passengers", c.dayPassengersUntil(), "You may carry passengers by day until", "14 CFR 61.57(a)", today);
        add(out, "night-passengers", c.nightPassengersUntil(), "You may carry passengers at night until", "14 CFR 61.57(b)", today);
        add(out, "instrument", c.instrumentCurrentUntil(), "Your instrument currency runs out", "14 CFR 61.57(c)", today);
        return out;
    }

    private static void add(List<Reminder> out, String what, LocalDate until, String words, String rule, LocalDate today) {
        if (until == null) {
            return;
        }
        long days = ChronoUnit.DAYS.between(today, until);
        if (days < 0 || days > 30) {
            return;
        }
        String when = days == 0 ? "today" : days == 1 ? "tomorrow" : "in " + days + " days";
        out.add(new Reminder(what, words + " " + DAY.format(until) + ", " + when + " (" + rule + ").", until, days <= 7 ? 7 : 30));
    }

    @Scheduled(cron = "${app.reminders.cron:0 0 14 * * *}", zone = "UTC")
    public void sendDue() {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        for (Pilot pilot : pilots.findByRemindersTrue()) {
            try {
                sendTo(pilot, today);
            } catch (RuntimeException failed) {
                log.warn("Reminders for pilot {} not sent; tried again tomorrow", pilot.getId(), failed);
            }
        }
    }

    /** The pilot's reminders due today and not yet sent, in one email.
     *  @return how many it held */
    public int sendTo(Pilot pilot, LocalDate today) {
        CurrencyDto c = currency.currency(logbook.findByPilotIdOrderByFlownOnDescIdDesc(pilot.getId()),
                pilot.getFlightReviewOn(), pilot.getMedicalExpiresOn(), pilot.getIpcOn(), today);
        List<Reminder> due = due(c, today);
        if (due.isEmpty()) {
            return 0;
        }
        Integer sent = transaction.execute(status -> {
            List<Reminder> claimed = due.stream().filter(r -> jdbc.update(
                    "INSERT INTO reminders_sent (pilot_id, what, due_on, days_before) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
                    pilot.getId(), r.what(), r.dueOn(), r.daysBefore()) == 1).toList();
            if (claimed.isEmpty()) {
                return 0;
            }
            // Sent inside the claim: a failure undoes it, for tomorrow.
            mail.send(message(pilot, claimed));
            return claimed.size();
        });
        return sent == null ? 0 : sent;
    }

    static SimpleMailMessage message(Pilot pilot, List<Reminder> reminders) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(pilot.getEmail());
        message.setSubject(reminders.size() == 1
                ? "Wingtip Maps: " + reminders.get(0).words().replaceAll(", (today|tomorrow|in \\d+ days) \\(.*$", "")
                : "Wingtip Maps: " + reminders.size() + " dates coming up");
        StringBuilder body = new StringBuilder("Coming up, from your logbook in Wingtip Maps:\n\n");
        reminders.forEach(r -> body.append("- ").append(r.words()).append('\n'));
        body.append("\nYou asked for these reminders. Turn them off in the Logbook, under Currency.");
        message.setText(body.toString());
        return message;
    }
}
