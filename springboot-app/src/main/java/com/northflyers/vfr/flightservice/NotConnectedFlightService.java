package com.northflyers.vfr.flightservice;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.FlightPlanFilingRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** No Flight Service provider: nothing is filed or briefed through the
 *  app, and each asks says so (503), sending the pilot to Flight Service
 *  itself. The default until the owner's agreement with one is in place. */
@Service
@ConditionalOnProperty(name = "app.flight-service.provider", havingValue = "none", matchIfMissing = true)
public class NotConnectedFlightService implements FlightServiceGateway {

    @Override
    public String provider() {
        return "none";
    }

    @Override
    public boolean connected() {
        return false;
    }

    @Override
    public String file(Pilot pilot, FlightPlanFilingRequest plan) {
        throw new FlightServiceNotConnectedException();
    }

    @Override
    public String brief(Pilot pilot, FlightPlanFilingRequest plan) {
        throw new FlightServiceNotConnectedException();
    }
}
