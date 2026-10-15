package com.northflyers.vfr.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** The app's own jobs on a clock: the morning's currency reminders
 *  (ReminderService). Off in a test that sets app.reminders.cron to "-". */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
