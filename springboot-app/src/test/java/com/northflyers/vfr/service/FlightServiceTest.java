package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Flight;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.SaveFlightRequest;
import com.northflyers.vfr.repository.AircraftRepository;
import com.northflyers.vfr.repository.FlightRepository;
import com.northflyers.vfr.repository.RouteRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/** {@link FlightService#save}'s handling of a request-supplied
 *  {@code aircraftId} -- rejected with {@link NoSuchAircraftException}
 *  when it doesn't resolve for this pilot, attached when it does. Without
 *  a database: {@code FlightPersistenceTest} already proves the
 *  pilot-scoped repository query itself. */
@ExtendWith(MockitoExtension.class)
class FlightServiceTest {

    @Mock
    private FlightRepository flightRepository;

    @Mock
    private AircraftRepository aircraftRepository;

    @Mock
    private RouteRepository routeRepository;

    @InjectMocks
    private FlightService flightService;

    private final Pilot pilot = pilotWithId(1L);

    private static Pilot pilotWithId(long id) {
        Pilot pilot = new Pilot("pilot@example.com", "Test Pilot", "sub-" + id);
        ReflectionTestUtils.setField(pilot, "id", id);
        return pilot;
    }

    private static SaveFlightRequest request(Long aircraftId) {
        return new SaveFlightRequest(aircraftId, null, "C81", "KDLH", null, null, null, null, null, List.of());
    }

    @Test
    void savingWithSomeoneElsesAircraftIdIsRejected() {
        given(aircraftRepository.findByIdAndPilotId(99L, pilot.getId())).willReturn(Optional.empty());

        assertThatThrownBy(() -> flightService.save(pilot, request(99L)))
                .isInstanceOf(NoSuchAircraftException.class);

        org.mockito.Mockito.verify(flightRepository, never()).save(any());
    }

    @Test
    void savingWithNoAircraftIdFilesWithNoAircraftAttached() {
        given(flightRepository.save(any(Flight.class))).willAnswer(invocation -> invocation.getArgument(0));

        Flight saved = flightService.save(pilot, request(null));

        assertThat(saved.getAircraft()).isNull();
        assertThat(saved.getDepartureIdent()).isEqualTo("C81");
    }

    @Test
    void savingWithThisPilotsOwnAircraftIdAttachesIt() {
        Aircraft plane = new Aircraft(pilot, "N12345", "C172", 110.0, 8.5);
        given(aircraftRepository.findByIdAndPilotId(7L, pilot.getId())).willReturn(Optional.of(plane));
        given(flightRepository.save(any(Flight.class))).willAnswer(invocation -> invocation.getArgument(0));

        Flight saved = flightService.save(pilot, request(7L));

        assertThat(saved.getAircraft()).isEqualTo(plane);
    }
}
