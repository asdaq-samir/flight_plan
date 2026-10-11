package com.northflyers.vfr.dto;

/** Whether the pilot is emailed before their currency runs out: 30 and 7
 *  days before each (ReminderService). */
public record RemindersDto(boolean on) {
}
