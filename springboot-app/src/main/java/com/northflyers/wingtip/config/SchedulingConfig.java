package com.northflyers.wingtip.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** The app's own jobs on a clock: the morning's currency reminders
 *  (ReminderService), off in a test that sets app.reminders.cron to "-";
 *  and the flight watch's checks (FlightWatchService), every
 *  wingtip.watch.every, whose first run waits one interval. */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
