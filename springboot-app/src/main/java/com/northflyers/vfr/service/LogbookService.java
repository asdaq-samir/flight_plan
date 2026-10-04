package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.LogbookEntryRequest;
import com.northflyers.vfr.repository.LogbookRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

/** A pilot's logbook -- CRUD scoped by pilot at the repository
 *  ({@link LogbookRepository#findByIdAndPilotId}) -- and the two dates on
 *  the pilot their currency is reckoned from beside it. */
@Service
public class LogbookService {

    private final LogbookRepository entries;
    private final PilotRepository pilots;

    public LogbookService(LogbookRepository entries, PilotRepository pilots) {
        this.entries = entries;
        this.pilots = pilots;
    }

    public List<LogbookEntry> list(Pilot pilot) {
        return entries.findByPilotIdOrderByFlownOnDescIdDesc(pilot.getId());
    }

    public LogbookEntry add(Pilot pilot, LogbookEntryRequest r) {
        return entries.save(fill(new LogbookEntry(pilot), r));
    }

    public Optional<LogbookEntry> update(Pilot pilot, Long id, LogbookEntryRequest r) {
        return entries.findByIdAndPilotId(id, pilot.getId()).map(e -> entries.save(fill(e, r)));
    }

    /** @return true if an entry was actually deleted */
    public boolean delete(Pilot pilot, Long id) {
        return entries.findByIdAndPilotId(id, pilot.getId()).map(e -> {
            entries.delete(e);
            return true;
        }).orElse(false);
    }

    public Pilot setCurrencyDates(Pilot pilot, LocalDate flightReviewOn, LocalDate medicalExpiresOn) {
        pilot.setCurrencyDates(flightReviewOn, medicalExpiresOn);
        return pilots.save(pilot);
    }

    private static LogbookEntry fill(LogbookEntry e, LogbookEntryRequest r) {
        return e.set(r.flownOn(), blankToNull(r.aircraft()), blankToNull(r.aircraftType()), blankToNull(r.route()),
                r.totalHours(), r.nightHours(), r.crossCountryHours(), r.dayLandings(), r.nightLandings(),
                blankToNull(r.remarks()))
                .training(r.dualHours(), r.soloHours(), r.instrumentHours(), r.toweredLandings(), r.distanceNm(),
                        r.longestLegNm());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
