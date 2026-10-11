package com.northflyers.vfr.dto;

/** Whether the app files and briefs through Flight Service, and whose. */
public record FlightServiceStatus(boolean connected, String provider) {
}
