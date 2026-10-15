package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.EndorsementKind;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.AskInstructorRequest;
import com.northflyers.vfr.dto.AskReviewRequest;
import com.northflyers.vfr.dto.EndorsementRequest;
import com.northflyers.vfr.dto.FullNameRequest;
import com.northflyers.vfr.dto.KnowledgeTestRequest;
import com.northflyers.vfr.dto.TrainingDto;
import com.northflyers.vfr.service.InstructorService;
import com.northflyers.vfr.service.LogbookService;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.TrainingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import java.time.Instant;
import java.time.LocalDate;
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
 * A student's way to the checkride (see {@link TrainingService}): 61.109's
 * experience from the logbook, the knowledge test report's ACS codes, and
 * the endorsements given -- each set or taken out one at a time -- with
 * their name as their certificate gives it, the instructors they ask in,
 * and the solo cross-countries they put to them (InstructorService).
 * Pilot-scoped as the logbook is: 401 signed out.
 */
@RestController
@RequestMapping("/api/training")
public class TrainingController {

    private final TrainingService training;
    private final InstructorService instructors;
    private final LogbookService logbook;
    private final PilotService pilots;

    public TrainingController(TrainingService training, InstructorService instructors, LogbookService logbook, PilotService pilots) {
        this.training = training;
        this.instructors = instructors;
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
            if (EndorsementKind.of(code).isEmpty()) {
                return ResponseEntity.badRequest().build();
            }
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

    /** Their name as their certificate gives it, which endorsements name
     *  them by. */
    @PutMapping("/name")
    public ResponseEntity<TrainingDto> setName(Authentication authentication, @Valid @RequestBody FullNameRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> {
            instructors.setFullName(pilot, request.fullName());
            return ResponseEntity.ok(trainingOf(pilot));
        });
    }

    /** An instructor asked in by address, and emailed: 400 for their own,
     *  409 asked already, 429 past the day's asks. */
    @PostMapping("/instructors")
    public ResponseEntity<TrainingDto> askInstructor(Authentication authentication, @Valid @RequestBody AskInstructorRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> {
            instructors.ask(pilot, request.email(), Instant.now());
            return ResponseEntity.ok(trainingOf(pilot));
        });
    }

    /** An instructor, asked or taken, let go. */
    @DeleteMapping("/instructors/{id}")
    public ResponseEntity<TrainingDto> dropInstructor(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> instructors.drop(pilot, id)
                ? ResponseEntity.ok(trainingOf(pilot))
                : ResponseEntity.notFound().build());
    }

    /** A saved flight put to an instructor for its solo cross-country
     *  review (14 CFR 61.93(c)(3)), who is emailed: 404 for a flight or an
     *  instructor not theirs, 409 already with them. */
    @PostMapping("/reviews")
    public ResponseEntity<TrainingDto> askReview(Authentication authentication, @Valid @RequestBody AskReviewRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> {
            instructors.askReview(pilot, request, Instant.now());
            return ResponseEntity.ok(trainingOf(pilot));
        });
    }

    /** A review still waiting, taken back. */
    @DeleteMapping("/reviews/{id}")
    public ResponseEntity<TrainingDto> withdrawReview(Authentication authentication, @PathVariable Long id) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> instructors.withdrawReview(pilot, id)
                ? ResponseEntity.ok(trainingOf(pilot))
                : ResponseEntity.notFound().build());
    }

    private TrainingDto trainingOf(Pilot pilot) {
        return training.training(pilot, logbook.list(pilot), LocalDate.now());
    }
}
