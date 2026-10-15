package com.northflyers.vfr;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.PilotRepository;
import com.northflyers.vfr.service.ReminderService;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Reminders against a real Postgres: one sent is recorded and not sent
 * again that day or the next; one whose email fails is not recorded, and
 * is sent when the mail goes; and only the pilots who asked are reminded.
 */
@SpringBootTest(properties = "app.reminders.cron=-")
@Testcontainers
class ReminderSendTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18");

    @Autowired private ReminderService reminders;
    @Autowired private PilotRepository pilots;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private JavaMailSender mail;
    @Value("${MAIL_FROM:no-reply@northflyers.com}") private String from;

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 11);

    private Pilot pilotWithMedicalEnding(LocalDate on, boolean asked) {
        Pilot pilot = new Pilot(UUID.randomUUID() + "@example.com", "Test Pilot", "sub-" + UUID.randomUUID());
        pilot.setCurrencyDates(null, on, null);
        pilot.setReminders(asked);
        return pilots.save(pilot);
    }

    @Test
    void aReminderIsSentOnceAndAFailedOneWaitsForTheMail() {
        reset(mail);
        Pilot pilot = pilotWithMedicalEnding(TODAY.plusDays(20), true);

        assertThat(reminders.sendTo(pilot, TODAY)).isEqualTo(1);
        ArgumentCaptor<SimpleMailMessage> sent = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mail).send(sent.capture());
        assertThat(sent.getValue().getTo()).containsExactly(pilot.getEmail());
        assertThat(sent.getValue().getFrom()).isEqualTo(from);
        assertThat(sent.getValue().getText()).contains("in 20 days (14 CFR 61.23)");
        // The same day again, and the next: the 30-day reminder is not sent twice.
        assertThat(reminders.sendTo(pilot, TODAY)).isZero();
        assertThat(reminders.sendTo(pilot, TODAY.plusDays(1))).isZero();

        // Thirteen days on it is 7 days off: the mail fails, nothing is kept...
        doThrow(new MailSendException("down")).when(mail).send(any(SimpleMailMessage.class));
        assertThatThrownBy(() -> reminders.sendTo(pilot, TODAY.plusDays(13))).isInstanceOf(MailSendException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reminders_sent WHERE pilot_id = ? AND days_before = 7",
                Integer.class, pilot.getId())).isZero();
        // ...and the next day, the mail back, it goes.
        reset(mail);
        assertThat(reminders.sendTo(pilot, TODAY.plusDays(14))).isEqualTo(1);
        verify(mail, times(1)).send(any(SimpleMailMessage.class));
    }

    @Test
    void onlyThePilotsWhoAskedAreReminded() {
        Pilot asked = pilotWithMedicalEnding(TODAY.plusDays(3), true);
        Pilot not = pilotWithMedicalEnding(TODAY.plusDays(3), false);
        assertThat(pilots.findByRemindersTrue()).extracting(Pilot::getId).contains(asked.getId()).doesNotContain(not.getId());
    }
}
