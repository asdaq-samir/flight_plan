package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Aircraft;
import com.northflyers.vfr.domain.ChecklistItem;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.ChecklistDto;
import com.northflyers.vfr.repository.ChecklistItemRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** A pilot's airplane's checklist: its lines in order, grouped by section
 *  as they come, and replaced whole as the editor saves it. Empty where the
 *  airplane is not this pilot's (AircraftService scopes it). */
@Service
public class ChecklistService {

    private final AircraftService aircraft;
    private final ChecklistItemRepository items;

    public ChecklistService(AircraftService aircraft, ChecklistItemRepository items) {
        this.aircraft = aircraft;
        this.items = items;
    }

    public Optional<ChecklistDto> get(Pilot pilot, Long aircraftId) {
        return aircraft.get(pilot, aircraftId).map(a -> sectioned(items.findByAircraftIdOrderBySequenceNoAsc(a.getId())));
    }

    @Transactional
    public Optional<ChecklistDto> replace(Pilot pilot, Long aircraftId, ChecklistDto checklist) {
        return aircraft.get(pilot, aircraftId).map(a -> {
            items.deleteByAircraftId(a.getId());
            items.saveAll(lines(a, checklist));
            return checklist;
        });
    }

    private static List<ChecklistItem> lines(Aircraft a, ChecklistDto checklist) {
        List<ChecklistItem> out = new ArrayList<>();
        for (ChecklistDto.Section section : checklist.sections()) {
            for (ChecklistDto.Item item : section.items()) {
                String response = item.response() == null || item.response().isBlank() ? null : item.response().strip();
                out.add(new ChecklistItem(a, out.size(), section.title().strip(), item.challenge().strip(), response));
            }
        }
        return out;
    }

    /** Lines in order, each run of one section's a section. */
    static ChecklistDto sectioned(List<ChecklistItem> lines) {
        Map<String, List<ChecklistDto.Item>> sections = new LinkedHashMap<>();
        for (ChecklistItem line : lines) {
            sections.computeIfAbsent(line.getSection(), title -> new ArrayList<>())
                    .add(new ChecklistDto.Item(line.getChallenge(), line.getResponse()));
        }
        return new ChecklistDto(sections.entrySet().stream()
                .map(s -> new ChecklistDto.Section(s.getKey(), s.getValue())).toList());
    }
}
