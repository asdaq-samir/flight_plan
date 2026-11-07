import { describe, expect, it } from "vitest";
import type { Frequency, ProcedureDrawing, ProcedureMissedLeg } from "./api/types";
import {
  alongNm, approachBrief, approachCategory, approachQuiz, coachingSteps, lessonPath, lessonProfile, pathBetween, stopwatch,
} from "./approachLesson";
import { callEngine } from "./engine/engine";

// The engine's names behind the lesson's sentences, asked through the
// .wasm as approach_brief asks them inside the engine.
const descentFpm = (gsKt: number, angleDeg: number) => callEngine("approach_descent_fpm", { gs_kt: gsKt, angle_deg: angleDeg });
const roundedFpm = (fpm: number) => callEngine("approach_rounded_fpm", { fpm });
const minimumsKind = (name: string) => callEngine("approach_minimums_kind", { name });
const fixName = (ident: string) => callEngine("approach_fix_name", { ident });
const missedWords = (legs: ProcedureMissedLeg[] | undefined) => callEngine("approach_missed_words", { legs: legs ?? [] });
const briefFrequencies = (frequencies: Frequency[] | null) => callEngine("approach_brief_frequencies", { frequencies: frequencies ?? [] });
const SEE_THE_PLATE = "See the plate";

/** KDLH's ILS 09 via DLH as the CIFP of 29 Oct 2026 codes it: DL the IAF
 *  (a hold in lieu), CFBSJ the final approach course fix, PYKLA the FAF at
 *  3,300 on a 3.00° glideslope, the threshold the MAP, and its missed
 *  approach -- climb to 3,000 on 093°, a left turn to heading 320° to
 *  intercept, on 017° to CHERL at or above 4,500 and hold there. Its
 *  places rounded. */
const ILS: ProcedureDrawing = {
  airport: "KDLH", kind: "approach", id: "I09", name: "ILS RWY 09", transition: "DLH", cycle: "261029", stale: false,
  glidepath_deg: 3, final_course_deg: 93,
  lines: [
    { role: "transition", name: "DLH", points: [[46.80, -92.20], [46.84, -92.36]] },
    { role: "final", name: null, points: [[46.84, -92.36], [46.84, -92.33], [46.84, -92.30], [46.842, -92.21]] },
    { role: "missed", name: null, points: [[46.842, -92.21], [46.843, -92.17], [47.0, -92.1]] },
  ],
  holds: [
    { fix: "DL", turn: "R", inbound_deg: 92, missed: false, kind: "hold", points: [[46.84, -92.36], [46.83, -92.40], [46.84, -92.36]] },
    { fix: "CHERL", turn: "R", inbound_deg: 196, missed: true, kind: "hold", points: [[47.0, -92.1], [47.02, -92.12], [47.0, -92.1]] },
  ],
  fixes: [
    { ident: "DLH", lat: 46.80, lon: -92.20, roles: [], min_ft: null, max_ft: null, missed: false },
    { ident: "DL", lat: 46.84, lon: -92.36, roles: ["IAF", "hold"], min_ft: 3300, max_ft: null, missed: false },
    { ident: "CFBSJ", lat: 46.84, lon: -92.33, roles: ["FACF"], min_ft: 3300, max_ft: null, missed: false },
    { ident: "PYKLA", lat: 46.84, lon: -92.30, roles: ["FAF"], min_ft: 3300, max_ft: null, missed: false, vertical_angle_deg: 3 },
    { ident: "RW09", lat: 46.842, lon: -92.21, roles: ["MAP"], min_ft: null, max_ft: null, missed: false, vertical_angle_deg: 3 },
    { ident: "CHERL", lat: 47.0, lon: -92.1, roles: ["hold"], min_ft: 4500, max_ft: null, missed: true },
  ],
  missed_legs: [
    { path: "CA", fix: null, course_deg: 93, turn: null, min_ft: 3000, max_ft: null },
    { path: "VI", fix: null, course_deg: 320, turn: "L", min_ft: null, max_ft: null },
    { path: "CF", fix: "CHERL", course_deg: 17, turn: null, min_ft: 4500, max_ft: null },
    { path: "HM", fix: "CHERL", course_deg: 197, turn: "R", min_ft: 4500, max_ft: null },
  ],
};

/** A VOR approach with none of the extras: no glidepath, no final course,
 *  no missed approach legs coded, two step-downs inside the FAF. */
const BARE: ProcedureDrawing = {
  airport: "KXYZ", kind: "approach", id: "V27", name: "VOR RWY 27", transition: null, cycle: "261029", stale: false, missed_legs: [],
  lines: [{ role: "final", name: null, points: [[45, -93], [45, -93.1], [45, -93.2], [45, -93.25]] }],
  holds: [],
  fixes: [
    { ident: "AAAAA", lat: 45, lon: -93, roles: ["FAF"], min_ft: 2500, max_ft: null, missed: false },
    { ident: "BBBBB", lat: 45, lon: -93.1, roles: [], min_ft: 1900, max_ft: null, missed: false },
    { ident: "CCCCC", lat: 45, lon: -93.2, roles: [], min_ft: 1520, max_ft: null, missed: false },
    { ident: "RW27", lat: 45, lon: -93.25, roles: ["MAP"], min_ft: null, max_ft: null, missed: false },
  ],
};

const RADIO: Frequency[] = [
  { type: "ATIS", description: "ATIS", frequency_mhz: 124.1 },
  { type: "APP", description: "MINNEAPOLIS APP", frequency_mhz: 125.0 },
  { type: "TWR", description: "DULUTH TWR", frequency_mhz: 118.3 },
  { type: "GND", description: "GND", frequency_mhz: 121.9 },
];

describe("descentFpm", () => {
  it("is the FAA's rate of descent table: ground speed x 101.3 x tan(angle)", () => {
    // The TPP's Rate of Descent Table, 3.0°: 318 at 60 kt, 478 at 90, 637 at 120.
    expect(descentFpm(60, 3)).toBeCloseTo(318, 0);
    expect(descentFpm(90, 3)).toBeCloseTo(478, 0);
    expect(descentFpm(120, 3)).toBeCloseTo(637, 0);
    // About ground speed x 5.3 on 3.00°.
    expect(descentFpm(100, 3) / 100).toBeCloseTo(5.3, 1);
    // Steeper is faster: 3.5° at 90 kt, 557.
    expect(descentFpm(90, 3.5)).toBeCloseTo(557, 0);
    expect(roundedFpm(descentFpm(90, 3))).toBe(480);
  });
});

describe("approachCategory", () => {
  it("is 14 CFR 97.3's, by VREF or 1.3 VSO", () => {
    expect(approachCategory(90.9)).toBe("A");
    expect(approachCategory(91)).toBe("B");
    expect(approachCategory(120.9)).toBe("B");
    expect(approachCategory(121)).toBe("C");
    expect(approachCategory(141)).toBe("D");
    expect(approachCategory(166)).toBe("E");
    // 1.3 x 60 = 78, A; 1.3 x 70 = 91, B. VREF first where both are known.
    expect(approachCategory(null, 60)).toBe("A");
    expect(approachCategory(null, 70)).toBe("B");
    expect(approachCategory(85, 70)).toBe("A");
    expect(approachCategory(null, null)).toBeNull();
  });
});

describe("minimumsKind", () => {
  it("is a DA on a precision approach, an MDA on a non-precision one, either on an RNAV (GPS)", () => {
    expect(minimumsKind("ILS RWY 09")).toBe("DA");
    expect(minimumsKind("RNAV (RNP) Y RWY 08")).toBe("DA");
    expect(minimumsKind("RNAV (GPS) Y RWY 26L")).toBe("DA or MDA");
    expect(minimumsKind("LOC RWY 09")).toBe("MDA");
    expect(minimumsKind("VOR/DME-A")).toBe("MDA");
  });
});

describe("missedWords", () => {
  it("says the missed approach in the plate's words, leg by leg", () => {
    expect(missedWords(ILS.missed_legs)).toBe(
      "Climb to 3,000 on course 093°, then left turn to heading 320° to intercept, then on course 017° to CHERL climbing to 4,500, "
      + "then hold at CHERL, right turns, 197° inbound.",
    );
  });
  it("leaves to the plate what its words do not say, and is null with nothing coded", () => {
    expect(missedWords([{ path: "CA", fix: null, course_deg: 270, turn: null, min_ft: 2000, max_ft: null }, { path: "RF", fix: "X", course_deg: null, turn: "R", min_ft: null, max_ft: null }]))
      .toBe("Climb to 2,000 on course 270°, then as the plate shows.");
    expect(missedWords([{ path: "AF", fix: "X", course_deg: null, turn: "R", min_ft: null, max_ft: null }])).toBeNull();
    expect(missedWords([])).toBeNull();
    expect(missedWords(undefined)).toBeNull();
  });
  it("says a climbing turn, a heading to an altitude and a direct leg", () => {
    expect(missedWords([
      { path: "VA", fix: null, course_deg: 0, turn: "R", min_ft: 3000, max_ft: null },
      { path: "DF", fix: "ABC", course_deg: null, turn: null, min_ft: null, max_ft: null },
    ])).toBe("Climbing right turn to 3,000 on heading 360°, then direct ABC.");
  });
});

describe("approachBrief", () => {
  it("goes as a briefing does: the approach, the radio, the course, the fixes from the IAF to the FAF, the minimums, the MAP and the missed", () => {
    const brief = approachBrief({ drawing: ILS, frequencies: RADIO });
    expect(brief.map(b => b.key)).toEqual([
      "approach", "frequencies", "course", "fix:DLH", "fix:DL", "fix:CFBSJ", "fix:PYKLA", "minimums", "map", "missed",
    ]);
    const by = Object.fromEntries(brief.map(b => [b.key, b]));
    expect(by["fix:DL"]!.title).toBe("Initial Approach Fix");
    expect(by["fix:CFBSJ"]!.title).toBe("Intermediate Fix");
    expect(by["fix:PYKLA"]!.title).toBe("Final Approach Fix");
    expect(by["fix:PYKLA"]!.lines).toContain("Cross at or above 3,300 ft");
    expect(by["fix:PYKLA"]!.lines).toContain("Descend on the 3.00° path from here");
    expect(by.frequencies!.lines).toEqual(["ATIS 124.1", "Approach 125.0", "Tower 118.3"]);
    expect(by.course!.lines).toEqual(["093° magnetic", "Glidepath 3.00°"]);
    // The minimums are never the coded data's: the plate's.
    expect(by.minimums!.lines).toEqual(["DA: see the plate"]);
    expect(by.map!.lines[0]).toBe("At the decision altitude on the glidepath");
    expect(by.missed!.lines[0]).toMatch(/^Climb to 3,000 on course 093°/);
    // Each shows its fix or its part on the map.
    expect(by["fix:DL"]!.focus).toEqual({ fix: "DL", segment: null });
    expect(by.missed!.focus).toEqual({ fix: null, segment: "missed" });
  });
  it("says the airplane's category where its figures give a speed", () => {
    const by = Object.fromEntries(approachBrief({ drawing: ILS, vsoKt: 48 }).map(b => [b.key, b]));
    expect(by.minimums!.lines).toEqual(["DA: see the plate", "Category A"]);
  });
  it("says See the Plate for what the coded data does not hold, and makes up nothing", () => {
    const by = Object.fromEntries(approachBrief({ drawing: BARE }).map(b => [b.key, b]));
    expect(by.frequencies!.lines).toEqual([SEE_THE_PLATE]);
    expect(by.course!.lines).toEqual([SEE_THE_PLATE]);
    expect(by.missed!.lines).toEqual([SEE_THE_PLATE]);
    expect(by.minimums!.lines).toEqual(["MDA: see the plate"]);
    expect(by.approach!.lines).toContain("Vectors to final");
    expect(by["fix:BBBBB"]!.title).toBe("Step-Down Fix");
    expect(by["fix:AAAAA"]!.lines).toContain("Descend to the MDA from here");
    expect(by.map!.lines).toEqual(["The runway 27 threshold (MAP)"]);
  });
  it("says a procedure's data are out of date", () => {
    expect(approachBrief({ drawing: { ...ILS, stale: true } })[0]!.lines).toContain("Out of date: these are an older cycle's data");
  });
});

describe("briefFrequencies", () => {
  it("briefs the approach control as the plate's where the field lists none, and no CTAF it does not list", () => {
    expect(briefFrequencies([{ type: "UNICOM", description: "UNICOM", frequency_mhz: 122.8 }]))
      .toEqual(["Approach: see the plate", "CTAF 122.8"]);
    // ctafOf's MULTICOM 122.9 is a guess, not this field's.
    expect(briefFrequencies([{ type: "GND", description: "GND", frequency_mhz: 121.7 }])).toEqual(["Approach: see the plate"]);
    expect(briefFrequencies(null)).toEqual([SEE_THE_PLATE]);
  });
});

describe("coachingSteps", () => {
  it("flies the approach fix by fix in order, IAF to FAF, the decision, then the missed approach", () => {
    const steps = coachingSteps({ drawing: ILS }, 90);
    expect(steps.map(s => s.key)).toEqual(["fix:DLH", "fix:DL", "fix:CFBSJ", "fix:PYKLA", "decision", "missed"]);
    const faf = steps[3]!;
    expect(faf.title).toBe("Crossing PYKLA (FAF)");
    expect(faf.say).toBe("Descend on the 3.00° path, about 480 ft/min at 90 kt, and start the timer.");
    // PYKLA to the threshold along the line, and the time at 90 kt.
    const nm = alongNm(lessonPath(ILS), { lat: 46.842, lon: -92.21 }) - alongNm(lessonPath(ILS), { lat: 46.84, lon: -92.30 });
    expect(faf.why).toBe(`The final approach starts here. ${nm.toFixed(1)} nm to the missed approach point: ${stopwatch((nm / 90) * 3600)} at 90 kt.`);
    expect(steps[2]!.say).toBe("Cross CFBSJ at or above 3,300 ft and turn onto the final approach course, 093°.");
    const decision = steps[4]!;
    expect(decision.title).toBe("At the Decision Altitude");
    expect(decision.say).toMatch(/^Runway in sight\? Land\. Otherwise go missed: climb to 3,000 on course 093°/);
    expect(steps[5]!.focus).toEqual({ fix: "CHERL", segment: "missed" });
    expect(steps[5]!.at).toEqual({ lat: 47.0, lon: -92.1 });
  });
  it("gives the descent rate for the ground speed picked", () => {
    expect(coachingSteps({ drawing: ILS }, 120)[3]!.say).toContain("about 640 ft/min at 120 kt");
  });
  it("steps down to each next altitude where there is no path, and to the MDA at the last", () => {
    const steps = coachingSteps({ drawing: BARE }, 90);
    expect(steps.map(s => s.key)).toEqual(["fix:AAAAA", "fix:BBBBB", "fix:CCCCC", "decision"]);
    expect(steps[0]!.say).toBe("Descend to 1,900 at BBBBB and start the timer.");
    expect(steps[1]!.say).toBe("Cross BBBBB at or above 1,900 ft, then descend to 1,520 at CCCCC.");
    expect(steps[2]!.say).toBe("Cross CCCCC at or above 1,520 ft, then descend to the MDA (see the plate).");
    expect(steps[3]!.title).toBe("At the Missed Approach Point");
    expect(steps[3]!.say).toBe("Runway in sight? Land. Otherwise go missed: fly the missed approach the plate shows.");
  });
});

describe("approachQuiz", () => {
  const quiz = approachQuiz({ drawing: ILS }, 90);
  it("asks from the procedure's own data", () => {
    expect(quiz.map(q => q.key)).toEqual(["alt:DL", "alt:CFBSJ", "alt:PYKLA", "faf", "course", "descent", "decision", "missed-fix"]);
    const faf = quiz.find(q => q.key === "faf")!;
    expect(faf.choices[faf.answer]).toBe("PYKLA");
    expect(quiz.find(q => q.key === "course")!.choices).toContain("093°");
    const descent = quiz.find(q => q.key === "descent")!;
    expect(descent.choices[descent.answer]).toBe("480 ft/min");
    const missed = quiz.find(q => q.key === "missed-fix")!;
    expect(missed.choices[missed.answer]).toBe("CHERL");
  });
  it("never offers the answer as a wrong choice, nor any choice twice", () => {
    for (const drawing of [ILS, BARE]) {
      for (const q of approachQuiz({ drawing }, 90)) {
        expect(new Set(q.choices).size).toBe(q.choices.length);
        expect(q.choices.filter(c => c === q.choices[q.answer])).toHaveLength(1);
        expect(q.choices.length).toBeGreaterThanOrEqual(2);
        expect(q.choices.length).toBeLessThanOrEqual(4);
      }
    }
  });
  it("puts the answer in the same place each time it is asked", () => {
    expect(approachQuiz({ drawing: ILS }, 90)).toEqual(quiz);
  });
  it("asks nothing it cannot offer a wrong choice for", () => {
    const lone: ProcedureDrawing = { ...BARE, fixes: [{ ...BARE.fixes[0]!, roles: ["FAF"] }] };
    expect(approachQuiz({ drawing: lone }, 90)).toEqual([]);
  });
});

describe("the lesson's line", () => {
  it("runs transition, final, missed, each joint once, and from one fix to the next along it", () => {
    const path = lessonPath(ILS);
    expect(path).toHaveLength(7);
    const leg = pathBetween(path, { lat: 46.84, lon: -92.36 }, { lat: 46.84, lon: -92.30 });
    expect(leg).toEqual([{ lat: 46.84, lon: -92.36 }, { lat: 46.84, lon: -92.33 }, { lat: 46.84, lon: -92.30 }]);
    expect(pathBetween([], { lat: 1, lon: 1 }, { lat: 2, lon: 2 })).toHaveLength(2);
  });
  it("draws the side view's path down from the FAF's altitude at its angle", () => {
    const { marks, path } = lessonProfile(ILS);
    expect(marks.map(m => m.ident)).toEqual(["DLH", "DL", "CFBSJ", "PYKLA", "RW09"]);
    expect(marks.at(-1)!.ft).toBeNull();
    // 318 ft a mile on 3.00°, from 3,300 at PYKLA.
    const nm = path!.to.nm - path!.from.nm;
    expect(path!.from.ft).toBe(3300);
    expect(path!.to.ft).toBeCloseTo(3300 - nm * 318.4, -1);
    expect(lessonProfile(BARE).path).toBeNull();
  });
});

describe("fixName and stopwatch", () => {
  it("say a threshold by its runway and a time as a stopwatch does", () => {
    expect(fixName("RW09")).toBe("the runway 09 threshold");
    expect(fixName("PYKLA")).toBe("PYKLA");
    expect(stopwatch(125)).toBe("2:05");
  });
});
