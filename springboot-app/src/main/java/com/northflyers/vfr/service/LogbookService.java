package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.LogbookEntryRequest;
import com.northflyers.vfr.dto.LogbookImportResult;
import com.northflyers.vfr.repository.LogbookRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

    /** Entries brought in from a file, all or none: each not already in the
     *  logbook -- the same day, airplane, route and total time, as a file
     *  imported twice would give -- added, the rest counted. */
    @Transactional
    public LogbookImportResult importAll(Pilot pilot, List<LogbookEntryRequest> requests) {
        Set<String> seen = new HashSet<>();
        for (LogbookEntry e : list(pilot)) {
            seen.add(sameFlight(e.getFlownOn(), e.getAircraft(), e.getRoute(), e.getTotalHours()));
        }
        List<LogbookEntry> added = new ArrayList<>();
        for (LogbookEntryRequest r : requests) {
            if (seen.add(sameFlight(r.flownOn(), blankToNull(r.aircraft()), blankToNull(r.route()), r.totalHours()))) {
                added.add(fill(new LogbookEntry(pilot), r));
            }
        }
        entries.saveAll(added);
        return new LogbookImportResult(added.size(), requests.size() - added.size());
    }

    /** What makes two entries one flight, for an import. */
    private static String sameFlight(LocalDate on, String aircraft, String route, double totalHours) {
        return on + "|" + Objects.toString(aircraft, "").toUpperCase() + "|" + Objects.toString(route, "").toUpperCase()
                + "|" + Math.round(totalHours * 10);
    }

    /** @return true if an entry was actually deleted */
    public boolean delete(Pilot pilot, Long id) {
        return entries.findByIdAndPilotId(id, pilot.getId()).map(e -> {
            entries.delete(e);
            return true;
        }).orElse(false);
    }

    public Pilot setCurrencyDates(Pilot pilot, LocalDate flightReviewOn, LocalDate medicalExpiresOn, LocalDate ipcOn) {
        pilot.setCurrencyDates(flightReviewOn, medicalExpiresOn, ipcOn);
        return pilots.save(pilot);
    }

    private static LogbookEntry fill(LogbookEntry e, LogbookEntryRequest r) {
        return e.set(r.flownOn(), blankToNull(r.aircraft()), blankToNull(r.aircraftType()), blankToNull(r.route()),
                r.totalHours(), r.nightHours(), r.crossCountryHours(), r.dayLandings(), r.nightLandings(),
                blankToNull(r.remarks()))
                .training(r.dualHours(), r.soloHours(), r.instrumentHours(), r.toweredLandings(), r.distanceNm(),
                        r.longestLegNm())
                .instrument(r.approaches(), r.holding(), r.tracking());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
