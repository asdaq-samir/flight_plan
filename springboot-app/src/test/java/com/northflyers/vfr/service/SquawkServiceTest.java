package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.DeferredFor;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.domain.Squawk;
import com.northflyers.vfr.dto.SquawkDto;
import com.northflyers.vfr.dto.SquawkRequest;
import com.northflyers.vfr.repository.SquawkRepository;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/** A squawk's determination under 91.213(d) is an inoperative item's
 *  alone, its words kept trimmed; another pilot's airplane's squawks are
 *  neither read, written nor taken out. */
@ExtendWith(MockitoExtension.class)
class SquawkServiceTest {

    @Mock
    private AircraftService aircraft;

    @Mock
    private SquawkRepository squawks;

    @InjectMocks
    private SquawkService service;

    private static final Pilot PILOT = new Pilot("pilot@example.com", "A. Pilot", "sub-1");

    private static Aircraft plane() {
        Aircraft plane = new Aircraft(PILOT, "N12345", "C172", 110, 8.5, null, null, null, 40.0);
        ReflectionTestUtils.setField(plane, "id", 7L);
        return plane;
    }

    @Test
    void aDeterminationIsAnInoperativeItemsAlone() {
        given(aircraft.get(PILOT, 7L)).willReturn(Optional.of(plane()));
        given(squawks.save(any(Squawk.class))).willAnswer(call -> call.getArgument(0));

        SquawkDto chip = service.add(PILOT, 7L, new SquawkRequest(LocalDate.of(2026, 10, 10), " Paint chip on the cowl ", false,
                DeferredFor.ALL, null, " ")).orElseThrow();
        assertThat(chip.text()).isEqualTo("Paint chip on the cowl");
        assertThat(chip.deferredFor()).isNull();
        assertThat(chip.fixNote()).isNull();

        SquawkDto light = service.add(PILOT, 7L, new SquawkRequest(LocalDate.of(2026, 10, 10), "Landing light out", true,
                DeferredFor.VFR_DAY, null, null)).orElseThrow();
        assertThat(light.deferredFor()).isEqualTo(DeferredFor.VFR_DAY);
    }

    @Test
    void anotherPilotsAirplanesSquawksAreLeftAlone() {
        given(aircraft.get(any(), any())).willReturn(Optional.empty());
        SquawkRequest request = new SquawkRequest(LocalDate.of(2026, 10, 10), "x", false, null, null, null);
        assertThat(service.list(PILOT, 7L)).isEmpty();
        assertThat(service.add(PILOT, 7L, request)).isEmpty();
        assertThat(service.update(PILOT, 7L, 3L, request)).isEmpty();
        assertThat(service.delete(PILOT, 7L, 3L)).isFalse();
        verify(squawks, never()).save(any());
    }
}
