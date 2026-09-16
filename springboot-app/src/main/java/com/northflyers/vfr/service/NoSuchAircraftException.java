package com.northflyers.vfr.service;

/** Thrown when a request names an {@code aircraftId} that either
 *  doesn't exist or doesn't belong to the calling pilot -- the same
 *  "can't see it, so it isn't there" answer {@code findByIdAndPilotId}
 *  gives everywhere else, surfaced as an error here (rather than
 *  silently filing with no aircraft) because a request that names an
 *  id explicitly is asserting it should attach, not offering a hint. */
public class NoSuchAircraftException extends RuntimeException {

    public NoSuchAircraftException(Long aircraftId) {
        super("No such aircraft: " + aircraftId);
    }
}
