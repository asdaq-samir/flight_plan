package com.northflyers.wingtip.dto;

/** Whether the app files and briefs through Flight Service, and whose. */
public record FlightServiceStatus(boolean connected, String provider) {
}
