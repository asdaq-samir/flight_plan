package com.northflyers.vfr.domain;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The endorsements a student meets on the way to a private pilot
 * certificate, in the order they meet them: AC 61-65K's sample for each
 * (its appendix A, November 2025), word for word, with the 14 CFR section
 * it answers and how long it is good for. The one list of them -- the
 * Checkride page lists them, a student records the ones signed on paper,
 * an instructor signs them in the app from these words -- so the web asks
 * for it rather than keeping its own.
 *
 * <p>A template names the student {student} and each blank the sample
 * leaves ("[M/M]", "[airport name]") by its {@link Field}; {@link #render}
 * fills them in.
 */
public enum EndorsementKind {

    PRE_SOLO_KNOWLEDGE("pre-solo-knowledge", "A.3", "61.87(b)", "Pre-solo aeronautical knowledge", null,
            "I certify that {student} has satisfactorily completed the pre-solo knowledge test of 14 CFR § 61.87(b) for the"
                    + " {mm} aircraft.",
            Field.MM),
    PRE_SOLO_FLIGHT("pre-solo-flight", "A.4", "61.87(c)(1) and (2)", "Pre-solo flight training", null,
            "I certify that {student} has received and logged pre-solo flight training for the maneuvers and procedures that"
                    + " are appropriate to the {mm} aircraft. I have determined they have demonstrated satisfactory proficiency and"
                    + " safety on the maneuvers and procedures required by 14 CFR § 61.87 in this or similar make and model of"
                    + " aircraft to be flown.",
            Field.MM),
    // 61.87(n): "an endorsement ... by an authorized instructor who gave
    // the training within the 90 days preceding the date of the flight".
    SOLO_FIRST("solo-first", "A.6", "61.87(n)", "Solo flight (first 90 days)", 90,
            "I certify that {student} has received the required training to qualify for solo flying. I have determined they"
                    + " meet the applicable requirements of 14 CFR § 61.87(n) and are proficient to make solo flights in {mm}.",
            Field.MM),
    // 61.87(p)(4): current "provided an authorized instructor updates the
    // student's logbook every 90 days thereafter". The code a student's
    // own record of either has kept since V13.
    SOLO_90("solo-90", "A.7", "61.87(p)", "Solo flight (each further 90 days)", 90,
            "I certify that {student} has received the required training to qualify for solo flying. I have determined that"
                    + " they meet the applicable requirements of 14 CFR § 61.87(p) and are proficient to make solo flights in {mm}.",
            Field.MM),
    // 61.87(o)(3): from an instructor who gave the night training "within
    // the 90-day period preceding the date of the flight".
    SOLO_NIGHT("solo-night", "A.5", "61.87(o)", "Solo flight at night", 90,
            "I certify that {student} has received flight training at night on night flying procedures that include takeoffs,"
                    + " approaches, landings, and go-arounds at night at the {airport} airport where the solo flight will be"
                    + " conducted; navigation training at night in the vicinity of the {airport} airport where the solo flight will"
                    + " be conducted. This endorsement expires 90 calendar days from the date the flight training at night was"
                    + " received.",
            Field.AIRPORT),
    SOLO_25NM("solo-25nm", "A.8", "61.93(b)(1)", "Solo takeoffs and landings at another airport within 25 nm", null,
            "I certify that {student} has received the required training of 14 CFR § 61.93(b)(1). I have determined that they"
                    + " are proficient to practice solo takeoffs and landings at {airport}. The takeoffs and landings at {airport}"
                    + " are subject to the following conditions: {conditions}",
            Field.AIRPORT, Field.CONDITIONS_LISTED),
    SOLO_XC_TRAINING("solo-xc-training", "A.9", "61.93(c)(1) and (2)", "Solo cross-country training", null,
            "I certify that {student} has received the required solo cross-country training. I find they have met the"
                    + " applicable requirements of 14 CFR § 61.93 and are proficient to make solo cross-country flights in a {mm}"
                    + " aircraft, {category}.",
            Field.MM, Field.CATEGORY),
    // 61.93(c)(3): one for each solo cross-country, from the instructor who
    // reviewed its planning (61.93(d)). The AC's sample reads "from
    // [origination airport] to [origination airport]", a flight that comes
    // back; {to} is the last airport, the same one for such a flight.
    SOLO_XC_FLIGHT("solo-xc-flight", "A.10", "61.93(c)(3)", "A solo cross-country's planning", null,
            "I have reviewed the cross-country planning of {student}. I find the planning and preparation to be correct to make"
                    + " the solo flight from {from} to {to} via {via} with landings at {landings} in a {mm} aircraft on {date}."
                    + " {conditions}",
            Field.FROM, Field.TO, Field.VIA, Field.LANDINGS, Field.MM, Field.DATE, Field.CONDITIONS),
    SOLO_XC_50NM("solo-xc-50nm", "A.11", "61.93(b)(2)", "Repeated solo cross-country within 50 nm", null,
            "I certify that {student} has received the required training in both directions between and at both {airports}."
                    + " I have determined that they are proficient of 14 CFR § 61.93(b)(2) to conduct repeated solo cross-country"
                    + " flights over that route, subject to the following conditions: {conditions}",
            Field.AIRPORTS, Field.CONDITIONS_LISTED),
    // 61.95(a)(2) and (b)(2): "dated within the 90-day period preceding the
    // date of the flight".
    CLASS_B("class-b", "A.12", "61.95(a)", "Solo flight in Class B airspace", 90,
            "I certify that {student} has received the required training of 14 CFR § 61.95(a). I have determined they are"
                    + " proficient to conduct solo flights in {classB} airspace. {conditions}",
            Field.CLASS_B, Field.CONDITIONS),
    CLASS_B_AIRPORT("class-b-airport", "A.13", "61.95(b) and 91.131(b)(1)", "Solo at an airport in Class B airspace", 90,
            "I certify that {student} has received the required training of 14 CFR § 61.95(b)(1). I have determined that they"
                    + " are proficient to conduct solo flight operations at {airport}. {conditions}",
            Field.AIRPORT, Field.CONDITIONS),
    KNOWLEDGE_TEST("knowledge-test", "A.36", "61.35(a)(1), 61.103(d) and 61.105", "Aeronautical knowledge test", null,
            "I certify that {student} has received the required training in accordance with 14 CFR § 61.105. I have"
                    + " determined they are prepared for the {test} knowledge test.",
            Field.TEST),
    KNOWLEDGE_TEST_REVIEW("knowledge-test-review", "A.2", "61.39(a)(6)(iii)", "Review of the knowledge test's deficient areas",
            null,
            "I certify that {student} has demonstrated satisfactory knowledge of the subject areas in which they were deficient"
                    + " on the {test} airman knowledge test.",
            Field.TEST),
    PRACTICAL_TEST_PREREQUISITES("practical-test-prereq", "A.1", "61.39(a)(6)(i) and (ii)", "Prerequisites for the practical test",
            null,
            "I certify that {student} has received and logged training time within 2 calendar months preceding the month of"
                    + " application in preparation for the practical test and they are prepared for the required practical test"
                    + " for the issuance of {certificate} certificate.",
            Field.CERTIFICATE),
    // A.37 is "required in addition to the 14 CFR § 61.39 endorsements"
    // (A.1, A.2). The code a student's own record of it has kept since V13.
    PRACTICAL_TEST("practical-test", "A.37", "61.103(f), 61.107(b) and 61.109", "Flight proficiency and practical test", null,
            "I certify that {student} has received the required training in accordance with 14 CFR §§ 61.107 and 61.109. I"
                    + " have determined they are prepared for the {practical} practical test.",
            Field.PRACTICAL);

    /** A blank in a sample, as the instructor's sheet asks for it. */
    public enum Field {
        MM("mm", "Make and model", "Cessna 172", true),
        CATEGORY("category", "Aircraft category", "airplane", true),
        AIRPORT("airport", "Airport", "Waukegan National (KUGN)", true),
        AIRPORTS("airports", "Both airports", "KUGN and KENW", true),
        CLASS_B("classB", "Class B airspace", "Chicago", true),
        TEST("test", "Knowledge test", "Private Pilot Airplane", true),
        CERTIFICATE("certificate", "Certificate", "a private pilot", true),
        PRACTICAL("practical", "Practical test", "Private Pilot Airplane Single-Engine Land", true),
        FROM("from", "From", "KUGN", true),
        TO("to", "To", "KUGN", true),
        VIA("via", "Via", "KRFD, KJVL", true),
        LANDINGS("landings", "Landings at", "KRFD, KJVL and KUGN", true),
        DATE("date", "Date of the flight", "10-14-2026", true),
        // "[List any applicable conditions or limitations.]": nothing where
        // there are none, except where the sample's own words lead into
        // them ("subject to the following conditions:").
        CONDITIONS("conditions", "Conditions or limitations", "Winds 10 knots or less", false),
        CONDITIONS_LISTED("conditions", "Conditions", "Winds 10 knots or less", true);

        public final String key;
        public final String label;
        public final String example;
        public final boolean required;

        Field(String key, String label, String example, boolean required) {
            this.key = key;
            this.label = label;
            this.example = example;
            this.required = required;
        }
    }

    private static final Pattern BLANK = Pattern.compile("\\{([A-Za-z]+)}");

    public final String code;
    /** AC 61-65K's paragraph, "A.10". */
    public final String paragraph;
    /** The 14 CFR section it answers, "61.93(c)(3)". */
    public final String rule;
    public final String label;
    /** Days it is good for from the day it was signed, or null where it
     *  does not run out. */
    public final Integer validDays;
    public final String template;
    public final List<Field> fields;

    EndorsementKind(String code, String paragraph, String rule, String label, Integer validDays, String template, Field... fields) {
        this.code = code;
        this.paragraph = paragraph;
        this.rule = rule;
        this.label = label;
        this.validDays = validDays;
        this.template = template;
        this.fields = List.of(fields);
    }

    public static Optional<EndorsementKind> of(String code) {
        return Arrays.stream(values()).filter(k -> k.code.equals(code)).findFirst();
    }

    /** The fields this endorsement takes, trimmed, with any it does not
     *  take left out. */
    public Map<String, String> fieldsFrom(Map<String, String> given) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Field f : fields) {
            String value = given.get(f.key);
            out.put(f.key, value == null ? "" : value.strip().replaceAll("\\s+", " "));
        }
        return out;
    }

    /** The blanks still empty that must be filled, by their labels. */
    public List<String> missing(Map<String, String> fields) {
        return this.fields.stream().filter(f -> f.required && fields.getOrDefault(f.key, "").isBlank()).map(f -> f.label).toList();
    }

    /** The sample's words with the student's name and the fields in, as
     *  they are signed: a blank left empty leaves nothing, the spaces
     *  around it closed up. The web's sheet fills the same template the
     *  same way to show what will be signed, and a signature is refused
     *  when the two differ (InstructorService.sign). */
    public String render(String student, Map<String, String> fields) {
        Matcher m = BLANK.matcher(template);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String key = m.group(1);
            String value = key.equals("student") ? student : fields.getOrDefault(key, "");
            m.appendReplacement(out, Matcher.quoteReplacement(value));
        }
        m.appendTail(out);
        return out.toString().replaceAll("\\s+", " ").strip();
    }
}
