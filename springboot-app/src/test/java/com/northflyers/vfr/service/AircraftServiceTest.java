package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.repository.AircraftRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/** The pilot-scoping guard on update/delete, without a database --
 *  {@code FlightPersistenceTest}-style tests already prove the
 *  repository query itself scopes correctly; these prove the service
 *  actually calls it rather than {@code findById}. */
@ExtendWith(MockitoExtension.class)
class AircraftServiceTest {

    @Mock
    private AircraftRepository aircraftRepository;

    @InjectMocks
    private AircraftService aircraftService;

    // Pilot's id is JPA-generated, so a plain `new Pilot(...)` leaves it
    // null -- indistinguishable from another un-persisted Pilot. Set
    // directly so owner/stranger stub against different ids, the way two
    // real, saved pilots would.
    private final Pilot owner = pilotWithId(1L, "owner@example.com", "sub-owner");
    private final Pilot stranger = pilotWithId(2L, "stranger@example.com", "sub-stranger");

    private static Pilot pilotWithId(long id, String email, String subject) {
        Pilot pilot = new Pilot(email, "Test Pilot", subject);
        ReflectionTestUtils.setField(pilot, "id", id);
        return pilot;
    }

    @Test
    void updateIsEmptyWhenTheAircraftBelongsToAnotherPilot() {
        given(aircraftRepository.findByIdAndPilotId(1L, stranger.getId())).willReturn(Optional.empty());

        Optional<Aircraft> result = aircraftService.update(stranger, 1L, "N12345", "C172", 110.0, 8.5);

        assertThat(result).isEmpty();
        verify(aircraftRepository, never()).save(any());
    }

    @Test
    void updateSavesWhenTheAircraftBelongsToThisPilot() {
        Aircraft existing = new Aircraft(owner, "N12345", "C172", 110.0, 8.5);
        given(aircraftRepository.findByIdAndPilotId(1L, owner.getId())).willReturn(Optional.of(existing));
        given(aircraftRepository.save(existing)).willReturn(existing);

        Optional<Aircraft> result = aircraftService.update(owner, 1L, "N54321", "PA28", 115.0, 9.0);

        assertThat(result).isPresent();
        assertThat(result.get().getTailNumber()).isEqualTo("N54321");
    }

    @Test
    void deleteReturnsFalseWithoutDeletingWhenTheAircraftBelongsToAnotherPilot() {
        given(aircraftRepository.findByIdAndPilotId(1L, stranger.getId())).willReturn(Optional.empty());

        boolean deleted = aircraftService.delete(stranger, 1L);

        assertThat(deleted).isFalse();
        verify(aircraftRepository, never()).delete(any());
    }

    @Test
    void deleteReturnsTrueWhenTheAircraftBelongsToThisPilot() {
        Aircraft existing = new Aircraft(owner, "N12345", "C172", 110.0, 8.5);
        given(aircraftRepository.findByIdAndPilotId(1L, owner.getId())).willReturn(Optional.of(existing));

        boolean deleted = aircraftService.delete(owner, 1L);

        assertThat(deleted).isTrue();
        verify(aircraftRepository).delete(existing);
    }
}
