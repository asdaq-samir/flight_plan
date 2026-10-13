package com.northflyers.vfr.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** The student endorsements as AC 61-65K words them: every blank a
 *  template leaves is one of its fields, the words come out as the AC's
 *  own sample reads with the blanks filled, and the ones that run out run
 *  out when 14 CFR says. */
class EndorsementKindTest {

    @Test
    void everyBlankIsTheStudentOrOneOfItsFields_andEveryFieldIsABlank() {
        Pattern blank = Pattern.compile("\\{([A-Za-z]+)}");
        for (EndorsementKind kind : EndorsementKind.values()) {
            Set<String> blanks = new HashSet<>();
            Matcher m = blank.matcher(kind.template);
            while (m.find()) {
                blanks.add(m.group(1));
            }
            Set<String> fields = new HashSet<>(kind.fields.stream().map(f -> f.key).toList());
            fields.add("student");
            assertThat(blanks).as(kind.code).isEqualTo(fields);
        }
        assertThat(Arrays.stream(EndorsementKind.values()).map(k -> k.code).distinct()).hasSize(EndorsementKind.values().length);
    }

    /** AC 61-65K A.10, its blanks filled: "I have reviewed the
     *  cross-country planning of [First name, MI, Last name]. I find the
     *  planning and preparation to be correct to make the solo flight from
     *  [origination airport] to [origination airport] via [route of
     *  flight] with landings at [names of the airports] in a [M/M]
     *  aircraft on [date]. [List any applicable conditions or
     *  limitations.]" */
    @Test
    void aSoloCrossCountryReadsAsTheAcsSampleWithNoConditionsLeavingNothing() {
        Map<String, String> fields = EndorsementKind.SOLO_XC_FLIGHT.fieldsFrom(Map.of("from", "KUGN", "to", "KUGN",
                "via", "KRFD, KJVL", "landings", "KRFD, KJVL and KUGN", "mm", "Cessna 172", "date", "10-14-2026", "extra", "x"));
        assertThat(fields).doesNotContainKey("extra").containsEntry("conditions", "");
        assertThat(EndorsementKind.SOLO_XC_FLIGHT.missing(fields)).isEmpty();
        assertThat(EndorsementKind.SOLO_XC_FLIGHT.render("Avery B. Student", fields)).isEqualTo(
                "I have reviewed the cross-country planning of Avery B. Student. I find the planning and preparation to be correct"
                        + " to make the solo flight from KUGN to KUGN via KRFD, KJVL with landings at KRFD, KJVL and KUGN in a Cessna"
                        + " 172 aircraft on 10-14-2026.");
    }

    @Test
    void conditionsWhereTheSamplesWordsLeadIntoThemMustBeGiven() {
        Map<String, String> fields = EndorsementKind.SOLO_25NM.fieldsFrom(Map.of("airport", "KENW"));
        assertThat(EndorsementKind.SOLO_25NM.missing(fields)).containsExactly("Conditions");
        assertThat(EndorsementKind.CLASS_B.missing(EndorsementKind.CLASS_B.fieldsFrom(Map.of("classB", "Chicago")))).isEmpty();
    }

    /** 61.87(n), (o)(3), (p) and 61.95(a)(2), (b)(2): 90 days. The others
     *  do not run out. */
    @Test
    void theNinetyDayOnesAreTheSoloNightAndClassBOnes() {
        List<String> ninety = Arrays.stream(EndorsementKind.values()).filter(k -> k.validDays != null)
                .peek(k -> assertThat(k.validDays).isEqualTo(90)).map(k -> k.code).toList();
        assertThat(ninety).containsExactlyInAnyOrder("solo-first", "solo-90", "solo-night", "class-b", "class-b-airport");
    }

    @Test
    void theCodesAStudentsOwnRecordKeptSinceV13AreStillHere() {
        for (String code : List.of("pre-solo-knowledge", "pre-solo-flight", "solo-90", "solo-night", "solo-xc-training",
                "solo-xc-flight", "solo-xc-50nm", "class-b", "class-b-airport", "knowledge-test", "knowledge-test-review",
                "practical-test")) {
            assertThat(EndorsementKind.of(code)).as(code).isPresent();
        }
    }
}
