package com.northflyers.vfr.controller;

import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.DeclineRequest;
import com.northflyers.vfr.dto.InstructorDto;
import com.northflyers.vfr.dto.InstructorRequest;
import com.northflyers.vfr.dto.SignRequest;
import com.northflyers.vfr.dto.TrainingDto;
import com.northflyers.vfr.service.InstructorService;
import com.northflyers.vfr.service.LogbookService;
import com.northflyers.vfr.service.PilotService;
import com.northflyers.vfr.service.TrainingService;
import jakarta.validation.Valid;
import java.time.Instant;
import java.time.LocalDate;
import java.util.function.Function;
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
 * A pilot as a flight instructor (see {@link InstructorService}): their
 * certificate, the students who asked them in, each student's record,
 * the endorsements they sign and void, and the solo cross-countries put to
 * them. Pilot-scoped: 401 signed out; a student not theirs is 404.
 */
@RestController
@RequestMapping("/api/instructor")
public class InstructorController {

    private final InstructorService instructors;
    private final TrainingService training;
    private final LogbookService logbook;
    private final PilotService pilots;

    public InstructorController(InstructorService instructors, TrainingService training, LogbookService logbook, PilotService pilots) {
        this.instructors = instructors;
        this.training = training;
        this.logbook = logbook;
        this.pilots = pilots;
    }

    @GetMapping
    public ResponseEntity<InstructorDto> get(Authentication authentication) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> ResponseEntity.ok(page(pilot)));
    }

    /** Their certificate as endorsements print it, and their name. */
    @PutMapping
    public ResponseEntity<InstructorDto> set(Authentication authentication, @Valid @RequestBody InstructorRequest request) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> {
            instructors.setInstructor(pilot, request);
            return ResponseEntity.ok(page(pilot));
        });
    }

    /** No longer an instructor: what they signed stays signed. */
    @DeleteMapping
    public ResponseEntity<InstructorDto> stop(Authentication authentication) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> {
            instructors.stopInstructing(pilot);
            return ResponseEntity.ok(page(pilot));
        });
    }

    /** A student's ask taken, where it was made of this pilot's address. */
    @PostMapping("/students/{linkId}/accept")
    public ResponseEntity<InstructorDto> accept(Authentication authentication, @PathVariable Long linkId) {
        return changed(authentication, pilot -> instructors.accept(pilot, linkId, Instant.now()));
    }

    /** An ask turned down, or a student given up. */
    @DeleteMapping("/students/{linkId}")
    public ResponseEntity<InstructorDto> leave(Authentication authentication, @PathVariable Long linkId) {
        return changed(authentication, pilot -> instructors.leave(pilot, linkId));
    }

    /** One student's record, as their instructor reads it. */
    @GetMapping("/students/{studentId}/training")
    public ResponseEntity<TrainingDto> student(Authentication authentication, @PathVariable Long studentId) {
        return PilotResponses.found(pilots, authentication, pilot -> instructors.student(pilot, studentId)
                .map(student -> recordOf(pilot, student)));
    }

    /** An endorsement signed for one of their students: 400 a field
     *  missing or a day not today, 409 the words not what the fields make,
     *  their certificate not given, or the student's name not given. A
     *  certificate past its date (14 CFR 61.197(a), (e)) is signed with,
     *  the screens having warned: the app never refuses on it. */
    @PostMapping("/students/{studentId}/endorsements")
    public ResponseEntity<TrainingDto> sign(Authentication authentication, @PathVariable Long studentId,
                                            @Valid @RequestBody SignRequest request) {
        return PilotResponses.found(pilots, authentication, pilot -> instructors.student(pilot, studentId)
                .map(student -> {
                    instructors.sign(pilot, student, request, Instant.now());
                    return recordOf(pilot, student);
                }));
    }

    /** One they signed, voided for a correction. */
    @PostMapping("/endorsements/{id}/void")
    public ResponseEntity<InstructorDto> voidEndorsement(Authentication authentication, @PathVariable Long id) {
        return changed(authentication, pilot -> instructors.voidEndorsement(pilot, id, Instant.now()));
    }

    /** A solo cross-country turned down, and why. */
    @PostMapping("/reviews/{id}/decline")
    public ResponseEntity<InstructorDto> decline(Authentication authentication, @PathVariable Long id,
                                                 @Valid @RequestBody DeclineRequest request) {
        return changed(authentication, pilot -> instructors.decline(pilot, id, request.note(), Instant.now()));
    }

    private ResponseEntity<InstructorDto> changed(Authentication authentication, Function<Pilot, Boolean> change) {
        return PilotResponses.withPilot(pilots, authentication, pilot -> change.apply(pilot)
                ? ResponseEntity.ok(page(pilot))
                : ResponseEntity.notFound().build());
    }

    private InstructorDto page(Pilot pilot) {
        return instructors.instructor(pilot, Instant.now());
    }

    private TrainingDto recordOf(Pilot instructor, Pilot student) {
        return training.trainingFor(instructor, student, logbook.list(student), LocalDate.now());
    }
}
