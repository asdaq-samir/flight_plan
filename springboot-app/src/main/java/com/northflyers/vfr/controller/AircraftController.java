package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.dto.AircraftDto;
import com.northflyers.vfr.dto.AircraftRequest;
import com.northflyers.vfr.dto.ChecklistDto;
import com.northflyers.vfr.dto.InspectionsRequest;
import com.northflyers.vfr.dto.VorCheckRequest;
import com.northflyers.vfr.service.AircraftService;
import com.northflyers.vfr.service.ChecklistService;
import com.northflyers.vfr.service.PilotService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
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
 * CRUD for a pilot's own aeroplanes. Every method starts the same way
 * -- resolve the signed-in pilot or answer 401 -- because unlike
 * {@link PlannerProxyController} (public, shared data), everything here is
 * pilot-scoped; {@link com.northflyers.vfr.security.SecurityConfig} already refuses an
 * unauthenticated caller before a request reaches here, but that
 * refusal is a redirect-avoiding 401 with no body, and {@code
 * Authentication} can still carry a principal Spring Security accepted
 * that {@link PilotService} doesn't recognise as OIDC -- so this
 * layer resolves the pilot itself rather than assuming one exists.
 */
@RestController
@RequestMapping("/api/aircraft")
public class AircraftController {

    private final AircraftService aircraftService;
    private final ChecklistService checklists;
    private final PilotService pilots;

    public AircraftController(AircraftService aircraftService, ChecklistService checklists, PilotService pilots) {
        this.aircraftService = aircraftService;
        this.checklists = checklists;
        this.pilots = pilots;
    }

    @GetMapping
    public ResponseEntity<List<AircraftDto>> list(Authentication authentication) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                ResponseEntity.ok(aircraftService.list(pilot).stream().map(AircraftController::toDto).toList()));
    }

    @PostMapping
    public ResponseEntity<AircraftDto> add(Authentication authentication, @Valid @RequestBody AircraftRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> ResponseEntity.ok(toDto(aircraftService.add(
                pilot, request.tailNumber(), request.typeDesignator(), request.cruiseTasKt(), request.fuelBurnGph(),
                request.cruisePowerPct(), request.climbTasKt(), request.climbFuelBurnGph(), request.usableFuelGal()))));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AircraftDto> update(
            Authentication authentication, @PathVariable Long id, @Valid @RequestBody AircraftRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> aircraftService
                .update(pilot, id, request.tailNumber(), request.typeDesignator(), request.cruiseTasKt(), request.fuelBurnGph(),
                        request.cruisePowerPct(), request.climbTasKt(), request.climbFuelBurnGph(), request.usableFuelGal())
                .map(a -> ResponseEntity.ok(toDto(a)))
                .orElse(ResponseEntity.notFound().build()));
    }

    /** The airplane's VOR check for IFR, recorded (14 CFR 91.171(d)). */
    @PutMapping("/{id}/vor-check")
    public ResponseEntity<AircraftDto> vorCheck(
            Authentication authentication, @PathVariable Long id, @Valid @RequestBody VorCheckRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> aircraftService
                .recordVorCheck(pilot, id, request.checkedOn(), request.kind(), request.place(), request.errorDeg())
                .map(a -> ResponseEntity.ok(toDto(a)))
                .orElse(ResponseEntity.notFound().build()));
    }

    /** The airplane's inspections and tests, recorded all at once. */
    @PutMapping("/{id}/inspections")
    public ResponseEntity<AircraftDto> inspections(
            Authentication authentication, @PathVariable Long id, @Valid @RequestBody InspectionsRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> aircraftService
                .recordInspections(pilot, id, request)
                .map(a -> ResponseEntity.ok(toDto(a)))
                .orElse(ResponseEntity.notFound().build()));
    }

    /** The airplane's checklist, its sections in order. */
    @GetMapping("/{id}/checklist")
    public ResponseEntity<ChecklistDto> checklist(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> checklists.get(pilot, id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build()));
    }

    /** The airplane's checklist, replaced whole as its editor saves it. */
    @PutMapping("/{id}/checklist")
    public ResponseEntity<ChecklistDto> saveChecklist(
            Authentication authentication, @PathVariable Long id, @Valid @RequestBody ChecklistDto request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> checklists.replace(pilot, id, request)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                aircraftService.delete(pilot, id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build());
    }

    private static AircraftDto toDto(Aircraft a) {
        return new AircraftDto(a.getId(), a.getTailNumber(), a.getTypeDesignator(), a.getCruiseTasKt(),
                a.getFuelBurnGph(), a.getCruisePowerPct(), a.getClimbTasKt(), a.getClimbFuelBurnGph(), a.getUsableFuelGal(),
                a.getCreatedAt(), vorCheckOf(a), inspectionsOf(a));
    }

    /** The last day of the calendar month `months` after the one `on` is
     *  in: what "within the preceding N calendar months" leaves an
     *  inspection good through -- an annual on 5 October 2025 to 31 October
     *  2026. */
    static LocalDate endOfCalendarMonths(LocalDate on, int months) {
        return on == null ? null : on.plusMonths(months).with(TemporalAdjusters.lastDayOfMonth());
    }

    /** 91.409(a): the annual, 12 calendar months; 91.409(b): the 100-hour,
     *  100 hours of time in service; 91.411(a)(1) and 91.413(a): the static
     *  and transponder tests, 24 calendar months; 91.207(d): the ELT's
     *  inspection, 12 calendar months after the last. */
    static AircraftDto.InspectionsDto inspectionsOf(Aircraft a) {
        return new AircraftDto.InspectionsDto(
                a.getAnnualOn(), endOfCalendarMonths(a.getAnnualOn(), 12),
                a.getHundredHourAtHours(), a.getHoursNow(),
                a.getHundredHourAtHours() == null ? null : a.getHundredHourAtHours() + 100,
                a.getStaticCheckOn(), endOfCalendarMonths(a.getStaticCheckOn(), 24),
                a.getTransponderCheckOn(), endOfCalendarMonths(a.getTransponderCheckOn(), 24),
                a.getEltInspectedOn(), endOfCalendarMonths(a.getEltInspectedOn(), 12),
                a.getEltBatteryDueOn());
    }

    /** 91.171(a)(2): good for 30 days, the error within its check's limit. */
    static AircraftDto.VorCheckDto vorCheckOf(Aircraft a) {
        if (a.getVorCheckOn() == null || a.getVorCheckKind() == null || a.getVorCheckErrorDeg() == null) {
            return null;
        }
        double limit = a.getVorCheckKind().limitDeg();
        return new AircraftDto.VorCheckDto(a.getVorCheckOn(), a.getVorCheckKind(), a.getVorCheckPlace(),
                a.getVorCheckErrorDeg(), limit, Math.abs(a.getVorCheckErrorDeg()) <= limit, a.getVorCheckOn().plusDays(30));
    }
}
