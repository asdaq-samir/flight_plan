package com.northflyers.vfr.domain;

/**
 * What a signed-in person may do here.
 *
 * <p>{@code PILOT} is everyone: plan a route, keep aeroplanes, file
 * flights. {@code DEVELOPER} additionally sees the training workspace
 * and the developer console -- rating chart detections, starting a
 * retrain, reading the stack's own health -- which is work on the model
 * rather than work on a flight.
 *
 * <p>Granted deliberately, never inherited: the column defaults to
 * {@code PILOT} and a developer is made with an UPDATE.
 */
public enum PilotRole {
    PILOT,
    DEVELOPER;

    public boolean isDeveloper() {
        return this == DEVELOPER;
    }
}
