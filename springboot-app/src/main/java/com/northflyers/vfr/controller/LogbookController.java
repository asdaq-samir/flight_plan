package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.CurrencyDatesRequest;
import com.northflyers.vfr.dto.CurrencyDto;
import com.northflyers.vfr.dto.LogbookEntryDto;
import com.northflyers.vfr.dto.LogbookEntryRequest;
import com.northflyers.vfr.service.CurrencyService;
import com.northflyers.vfr.service.LogbookService;
import com.northflyers.vfr.service.PilotService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The pilot's logbook and their currency (see {@link CurrencyService}):
 * the entries, newest first, added, changed and taken out one at a
 * time, and where the pilot stands -- passengers by day and at night,
 * the flight review, the medical -- with the two dates they give.
 * Pilot-scoped as the aircraft are: 401 signed out.
 */
@RestController
@RequestMapping("/api/logbook")
public class LogbookController {

    private final LogbookService logbook;
    private final CurrencyService currency;
    private final PilotService pilots;

    public LogbookController(LogbookService logbook, CurrencyService currency, PilotService pilots) {
        this.logbook = logbook;
        this.currency = currency;
        this.pilots = pilots;
    }

    @GetMapping
    public ResponseEntity<List<LogbookEntryDto>> list(Authentication authentication) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                ResponseEntity.ok(logbook.list(pilot).stream().map(LogbookController::toDto).toList()));
    }

    @PostMapping
    public ResponseEntity<LogbookEntryDto> add(Authentication authentication, @Valid @RequestBody LogbookEntryRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> ResponseEntity.ok(toDto(logbook.add(pilot, request))));
    }

    @PutMapping("/{id}")
    public ResponseEntity<LogbookEntryDto> update(
            Authentication authentication, @PathVariable Long id, @Valid @RequestBody LogbookEntryRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> logbook.update(pilot, id, request)
                .map(e -> ResponseEntity.ok(toDto(e)))
                .orElse(ResponseEntity.notFound().build()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                logbook.delete(pilot, id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    @GetMapping("/currency")
    public ResponseEntity<CurrencyDto> currency(Authentication authentication) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> ResponseEntity.ok(currencyOf(pilot)));
    }

    @PutMapping("/currency")
    public ResponseEntity<CurrencyDto> setCurrencyDates(Authentication authentication, @RequestBody CurrencyDatesRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> ResponseEntity.ok(currencyOf(
                logbook.setCurrencyDates(pilot, request.flightReviewOn(), request.medicalExpiresOn()))));
    }

    private CurrencyDto currencyOf(Pilot pilot) {
        return currency.currency(logbook.list(pilot), pilot.getFlightReviewOn(), pilot.getMedicalExpiresOn());
    }

    private static LogbookEntryDto toDto(LogbookEntry e) {
        return new LogbookEntryDto(e.getId(), e.getFlownOn(), e.getAircraft(), e.getAircraftType(), e.getRoute(),
                e.getTotalHours(), e.getNightHours(), e.getCrossCountryHours(), e.getDayLandings(), e.getNightLandings(),
                e.getRemarks(), e.getDualHours(), e.getSoloHours(), e.getInstrumentHours(), e.getToweredLandings(),
                e.getDistanceNm(), e.getLongestLegNm());
    }
}
