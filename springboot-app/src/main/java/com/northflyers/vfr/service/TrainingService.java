package com.northflyers.vfr.service;

import com.northflyers.vfr.domain.Endorsement;
import com.northflyers.vfr.domain.LogbookEntry;
import com.northflyers.vfr.domain.Pilot;
import com.northflyers.vfr.dto.EndorsementDto;
import com.northflyers.vfr.dto.ExperienceItemDto;
import com.northflyers.vfr.dto.TrainingDto;
import com.northflyers.vfr.repository.EndorsementRepository;
import com.northflyers.vfr.repository.PilotRepository;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Predicate;
import java.util.function.ToDoubleFunction;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A student's way to the private pilot checkride, reckoned from the
 * logbook: 14 CFR 61.109(a)'s aeronautical experience for an airplane
 * single-engine rating, item by item -- with the ACS codes on their
 * knowledge test report and their instructor's endorsements kept beside
 * it. As with currency, none of this is anyone's sign-off: the
 * instructor's endorsement for the practical test is (61.39(a)(6)).
 *
 * <p>Hours flown with an instructor and cross-country are counted as the
 * smaller of the two on each entry, a logbook recording them in separate
 * columns: two hours of dual on a flight with one hour cross-country is
 * one hour of dual cross-country.
 */
@Service
public class TrainingService {

    private final EndorsementRepository endorsements;
    private final PilotRepository pilots;

    public TrainingService(EndorsementRepository endorsements, PilotRepository pilots) {
        this.endorsements = endorsements;
        this.pilots = pilots;
    }

    public TrainingDto training(Pilot pilot, List<LogbookEntry> entries, LocalDate today) {
        return new TrainingDto(experience(entries, today), codesOf(pilot),
                endorsements.findByKeyPilotIdOrderByKeyCode(pilot.getId()).stream()
                        .map(e -> new EndorsementDto(e.getKey().code(), e.getEndorsedOn())).toList());
    }

    @Transactional
    public Pilot setKnowledgeTestCodes(Pilot pilot, List<String> codes) {
        pilot.setKnowledgeTestCodes(codes.isEmpty() ? null : String.join(" ", codes.stream().distinct().toList()));
        return pilots.save(pilot);
    }

    @Transactional
    public void endorse(Pilot pilot, String code, LocalDate endorsedOn) {
        Endorsement.Key key = new Endorsement.Key(pilot.getId(), code);
        endorsements.findById(key).ifPresentOrElse(
                e -> e.endorsedOn(endorsedOn), () -> endorsements.save(new Endorsement(pilot.getId(), code, endorsedOn)));
    }

    /** @return true if the endorsement was there to take out */
    @Transactional
    public boolean withdraw(Pilot pilot, String code) {
        Endorsement.Key key = new Endorsement.Key(pilot.getId(), code);
        if (!endorsements.existsById(key)) {
            return false;
        }
        endorsements.deleteById(key);
        return true;
    }

    static List<String> codesOf(Pilot pilot) {
        String codes = pilot.getKnowledgeTestCodes();
        return codes == null || codes.isBlank() ? List.of() : Arrays.asList(codes.trim().split("\\s+"));
    }

    /** 61.109(a), item by item, as the logbook shows it on {@code today}. */
    static List<ExperienceItemDto> experience(List<LogbookEntry> entries, LocalDate today) {
        Predicate<LogbookEntry> dual = e -> e.getDualHours() > 0;
        Predicate<LogbookEntry> solo = e -> e.getSoloHours() > 0;
        // "Within the preceding 2 calendar months" of the test: from the
        // first of the month two months before this one.
        LocalDate twoMonths = YearMonth.from(today).minusMonths(2).atDay(1);
        List<ExperienceItemDto> items = new ArrayList<>();
        items.add(hours("total", "61.109(a)", "Flight time", sum(entries, e -> true, LogbookEntry::getTotalHours), 40));
        items.add(hours("dual", "61.109(a)", "Flight training from an instructor", sum(entries, e -> true, LogbookEntry::getDualHours), 20));
        items.add(hours("dualCrossCountry", "61.109(a)(1)", "Cross-country flight training",
                sum(entries, dual, e -> Math.min(e.getDualHours(), e.getCrossCountryHours())), 3));
        items.add(hours("dualNight", "61.109(a)(2)", "Night flight training",
                sum(entries, dual, e -> Math.min(e.getDualHours(), e.getNightHours())), 3));
        items.add(count("nightCrossCountry", "61.109(a)(2)(i)", "A night cross-country of over 100 nm total distance",
                entries.stream().anyMatch(dual.and(e -> e.getNightHours() > 0 && e.getDistanceNm() > 100)) ? 1 : 0, 1, "flights"));
        items.add(count("nightLandings", "61.109(a)(2)(ii)", "Night takeoffs and landings to a full stop, in the pattern",
                entries.stream().filter(dual).mapToInt(LogbookEntry::getNightLandings).sum(), 10, "landings"));
        items.add(hours("instrument", "61.109(a)(3)", "Flight training by reference to instruments",
                sum(entries, e -> true, LogbookEntry::getInstrumentHours), 3));
        items.add(hours("checkridePrep", "61.109(a)(4)", "Training for the practical test in the preceding 2 calendar months",
                sum(entries, dual.and(e -> !e.getFlownOn().isBefore(twoMonths)), LogbookEntry::getDualHours), 3));
        items.add(hours("solo", "61.109(a)(5)", "Solo flight time", sum(entries, e -> true, LogbookEntry::getSoloHours), 10));
        items.add(hours("soloCrossCountry", "61.109(a)(5)(i)", "Solo cross-country",
                sum(entries, solo, e -> Math.min(e.getSoloHours(), e.getCrossCountryHours())), 5));
        items.add(count("longSoloCrossCountry", "61.109(a)(5)(ii)",
                "A solo cross-country of 150 nm, full-stop landings at three points, one leg over 50 nm",
                entries.stream().anyMatch(solo.and(e -> e.getDistanceNm() >= 150 && e.getLongestLegNm() > 50
                        && e.getDayLandings() + e.getNightLandings() >= 3)) ? 1 : 0, 1, "flights"));
        items.add(count("toweredLandings", "61.109(a)(5)(iii)", "Solo full-stop landings at a towered airport",
                entries.stream().filter(solo).mapToInt(LogbookEntry::getToweredLandings).sum(), 3, "landings"));
        return items;
    }

    private static double sum(List<LogbookEntry> entries, Predicate<LogbookEntry> which, ToDoubleFunction<LogbookEntry> hours) {
        return Math.round(entries.stream().filter(which).mapToDouble(hours).sum() * 10) / 10.0;
    }

    private static ExperienceItemDto hours(String key, String rule, String label, double have, double need) {
        return new ExperienceItemDto(key, rule, label, have, need, "h", have >= need);
    }

    private static ExperienceItemDto count(String key, String rule, String label, int have, int need, String unit) {
        return new ExperienceItemDto(key, rule, label, have, need, unit, have >= need);
    }
}
