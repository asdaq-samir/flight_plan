package com.northflyers.vfr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.LogbookEntryRequest;
import com.northflyers.vfr.dto.LogbookImportResult;
import com.northflyers.vfr.repository.LogbookRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/** A logbook brought in from a file: what is already in it -- the same
 *  day, airplane, route and time, whatever their case -- and a flight the
 *  file gives twice are left out, the rest added together. */
@ExtendWith(MockitoExtension.class)
class LogbookServiceTest {

    @Mock
    private LogbookRepository entries;

    @Mock
    private PilotRepository pilots;

    @InjectMocks
    private LogbookService logbook;

    private static Pilot pilot() {
        Pilot pilot = new Pilot("pilot@example.com", "A. Pilot", "sub-1");
        ReflectionTestUtils.setField(pilot, "id", 1L);
        return pilot;
    }

    private static LogbookEntryRequest flight(String on, String aircraft, String route, double hours) {
        return new LogbookEntryRequest(LocalDate.parse(on), aircraft, "C172", route, hours, 0, 0, 1, 0, null,
                0, 0, 0, 0, 0, 0, 0, false, false);
    }

    @Test
    @SuppressWarnings("unchecked")
    void anImportAddsWhatIsNotThereAlreadyAndCountsTheRest() {
        Pilot pilot = pilot();
        LogbookEntry logged = new LogbookEntry(pilot).set(LocalDate.of(2026, 9, 20), "N12345", "C172", "C81 KDLH", 3.4, 0, 3.4, 1, 0, null);
        given(entries.findByPilotIdOrderByFlownOnDescIdDesc(1L)).willReturn(List.of(logged));

        LogbookImportResult result = logbook.importAll(pilot, List.of(
                flight("2026-09-20", "n12345", "c81 kdlh", 3.4),   // already logged
                flight("2026-09-21", "N12345", "KDLH C81", 3.1),
                flight("2026-09-21", "N12345", "KDLH C81", 3.1),   // twice in the file
                flight("2026-09-21", "N12345", "KDLH C81", 3.2)));  // another flight that day

        assertThat(result).isEqualTo(new LogbookImportResult(2, 2));
        ArgumentCaptor<List<LogbookEntry>> saved = ArgumentCaptor.forClass(List.class);
        verify(entries).saveAll(saved.capture());
        assertThat(saved.getValue()).extracting(LogbookEntry::getTotalHours).containsExactly(3.1, 3.2);
        assertThat(saved.getValue()).allSatisfy(e -> assertThat(e.getPilot()).isSameAs(pilot));
    }
}
