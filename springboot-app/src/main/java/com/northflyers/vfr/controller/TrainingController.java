package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.EndorsementRequest;
import com.northflyers.vfr.dto.KnowledgeTestRequest;
import com.northflyers.vfr.dto.TrainingDto;
import com.northflyers.vfr.service.LogbookService;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.TrainingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A student's way to the checkride (see {@link TrainingService}): 61.109's
 * experience from the logbook, the knowledge test report's ACS codes, and
 * the endorsements given -- each set or taken out one at a time.
 * Pilot-scoped as the logbook is: 401 signed out.
 */
@RestController
@RequestMapping("/api/training")
public class TrainingController {

    private final TrainingService training;
    private final LogbookService logbook;
    private final PilotService pilots;

    public TrainingController(TrainingService training, LogbookService logbook, PilotService pilots) {
        this.training = training;
        this.logbook = logbook;
        this.pilots = pilots;
    }

    @GetMapping
    public ResponseEntity<TrainingDto> get(Authentication authentication) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> ResponseEntity.ok(trainingOf(pilot)));
    }

    @PutMapping("/knowledge-test")
    public ResponseEntity<TrainingDto> setKnowledgeTest(Authentication authentication, @Valid @RequestBody KnowledgeTestRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot ->
                ResponseEntity.ok(trainingOf(training.setKnowledgeTestCodes(pilot, request.codes()))));
    }

    @PutMapping("/endorsements/{code}")
    public ResponseEntity<TrainingDto> endorse(
            Authentication authentication,
            @PathVariable @Pattern(regexp = "^[a-z0-9-]{1,40}$", message = "an endorsement's code") String code,
            @Valid @RequestBody EndorsementRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> {
            training.endorse(pilot, code, request.endorsedOn());
            return ResponseEntity.ok(trainingOf(pilot));
        });
    }

    @DeleteMapping("/endorsements/{code}")
    public ResponseEntity<TrainingDto> withdraw(Authentication authentication, @PathVariable String code) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> training.withdraw(pilot, code)
                ? ResponseEntity.ok(trainingOf(pilot))
                : ResponseEntity.notFound().build());
    }

    private TrainingDto trainingOf(Pilot pilot) {
        return training.training(pilot, logbook.list(pilot), LocalDate.now());
    }
}
