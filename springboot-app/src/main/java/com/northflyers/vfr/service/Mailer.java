package com.northflyers.vfr.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/**
 * The app's email -- the sign-in link, the currency reminders -- sent from
 * the one address the deployment gives (MAIL_FROM). A message with no From
 * of its own goes out under whatever Jakarta Mail makes of the server's
 * user and host name, which a real mail service refuses, so every message
 * goes through here.
 */
@Component
public class Mailer {

    private final JavaMailSender sender;
    private final String from;

    public Mailer(JavaMailSender sender, @Value("${MAIL_FROM:no-reply@northflyers.com}") String from) {
        this.sender = sender;
        this.from = from;
    }

    public void send(SimpleMailMessage message) {
        message.setFrom(from);
        sender.send(message);
    }
}
