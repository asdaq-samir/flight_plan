package com.northflyers.vfr.flightservice;

/** Asked to file or brief with no Flight Service provider connected. */
public class FlightServiceNotConnectedException extends RuntimeException {

    public FlightServiceNotConnectedException() {
        super("Filing and briefing through the app are not connected yet: file at 1800wxbrief.com, "
                + "or call Flight Service at 1-800-WX-BRIEF");
    }
}
