package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.ChecklistItem;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.ChecklistDto;
import com.northflyers.vfr.repository.ChecklistItemRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/** A checklist saved whole, its lines numbered in order across its
 *  sections, and read back grouped as it was written; another pilot's
 *  airplane's left alone. */
@ExtendWith(MockitoExtension.class)
class ChecklistServiceTest {

    @Mock
    private AircraftService aircraft;

    @Mock
    private ChecklistItemRepository items;

    @InjectMocks
    private ChecklistService checklists;

    private static final Pilot PILOT = new Pilot("pilot@example.com", "A. Pilot", "sub-1");

    private static Aircraft plane() {
        Aircraft plane = new Aircraft(PILOT, "N12345", "C172", 110, 8.5, null, null, null, 40.0);
        ReflectionTestUtils.setField(plane, "id", 7L);
        return plane;
    }

    @Test
    @SuppressWarnings("unchecked")
    void aChecklistIsSavedWholeInOrderAndReadBackBySection() {
        Aircraft plane = plane();
        given(aircraft.get(PILOT, 7L)).willReturn(Optional.of(plane));
        ChecklistDto written = new ChecklistDto(List.of(
                new ChecklistDto.Section(" Before start ", List.of(new ChecklistDto.Item("Preflight", "Complete"),
                        new ChecklistDto.Item("Seats, belts", " "))),
                new ChecklistDto.Section("Before takeoff", List.of(new ChecklistDto.Item("Fuel selector", "Both")))));

        assertThat(checklists.replace(PILOT, 7L, written)).contains(written);

        verify(items).deleteByAircraftId(7L);
        ArgumentCaptor<List<ChecklistItem>> saved = ArgumentCaptor.forClass(List.class);
        verify(items).saveAll(saved.capture());
        assertThat(saved.getValue()).extracting(ChecklistItem::getSequenceNo).containsExactly(0, 1, 2);
        assertThat(saved.getValue()).extracting(ChecklistItem::getSection).containsExactly("Before start", "Before start", "Before takeoff");
        assertThat(saved.getValue().get(1).getResponse()).isNull();

        ChecklistDto read = ChecklistService.sectioned(saved.getValue());
        assertThat(read.sections()).extracting(ChecklistDto.Section::title).containsExactly("Before start", "Before takeoff");
        assertThat(read.sections().get(0).items()).hasSize(2);
    }

    @Test
    void anotherPilotsAirplanesChecklistIsNeitherReadNorWritten() {
        given(aircraft.get(any(), any())).willReturn(Optional.empty());
        assertThat(checklists.get(PILOT, 7L)).isEmpty();
        assertThat(checklists.replace(PILOT, 7L, new ChecklistDto(List.of()))).isEmpty();
        verify(items, never()).deleteByAircraftId(any());
    }
}
