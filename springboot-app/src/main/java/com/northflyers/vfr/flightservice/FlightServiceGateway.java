package com.northflyers.vfr.flightservice;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.FlightPlanFilingRequest;

/**
 * Flight Service's own filing and briefing -- in the contiguous U.S.,
 * Leidos's, which a third-party app reaches only under an agreement with
 * it, the owner's to make. Until then the one implementation is
 * {@link NotConnectedFlightService}: the app says it is not connected,
 * and the pilot files at 1800wxbrief.com or by telephone (AIM 5-1-1) from
 * the Brief's flight plan form. A provider's implementation replaces it
 * by {@code app.flight-service.provider}.
 */
public interface FlightServiceGateway {

    /** The provider's name, "none" without one. */
    String provider();

    boolean connected();

    /**
     * Files a flight plan in the pilot's name.
     *
     * @return the provider's reference for it
     * @throws FlightServiceNotConnectedException without a provider
     */
    String file(Pilot pilot, FlightPlanFilingRequest plan);

    /**
     * A standard briefing for the route, as Flight Service gives one
     * (AIM 7-1-5), logged in the pilot's name as a briefing obtained.
     *
     * @return the briefing's text
     * @throws FlightServiceNotConnectedException without a provider
     */
    String brief(Pilot pilot, FlightPlanFilingRequest plan);
}
