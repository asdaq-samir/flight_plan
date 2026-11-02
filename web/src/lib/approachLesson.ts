import type { Frequency, ProcedureDrawing, ProcedureFix, ProcedureMissedLeg } from "./api/types";
import { stopwatchTime } from "./clock";
import { ctafOf, frequencyOf, mhzText } from "./frequencies";
import { distanceNm, rad, type LatLon } from "./geo";
import { altitudeLines } from "./procedures";
import { altFt, bearing } from "./units";

/**
 * An approach taught as an instructor teaches it, at the owner's ask
 * ("do it all", 2026-10-30): briefed before anything moves, flown fix by
 * fix with a word at each, and asked back. All of it from the FAA's coded
 * procedure (vfr.procedures, the CIFP) and the field's radio: what the
 * coded data does not hold -- the minimums above all -- is "See the
 * plate", never a figure made up. A training aid; the plate flies.
 */

export type LessonSegment = "transition" | "final" | "missed";

/** What a step of the lesson shows on the map: a fix ringed, a part of
 *  the procedure's line drawn over. */
export interface LessonFocus {
  fix: string | null;
  segment: LessonSegment | null;
}

export interface LessonInput {
  drawing: ProcedureDrawing;
  /** The field's radio (its card's), where it is in. */
  frequencies?: Frequency[] | null;
  /** The airplane's reference landing speed, kt, or its stall speed in the
   *  landing configuration, where its figures carry either: its approach
   *  category (approachCategory). */
  vrefKt?: number | null;
  vsoKt?: number | null;
}

/** "See the plate": what the lesson says where the coded data has nothing. */
export const SEE_THE_PLATE = "See the plate";

/** Feet in a nautical mile (the international nautical mile, 1,852 m). */
const FT_PER_NM = 6076.12;

/**
 * The rate of descent that holds a path of `angleDeg` at a ground speed of
 * `gsKt`, ft/min: the ground speed in feet a minute times the path's
 * tangent -- GS × 101.3 × tan(angle), about GS × 5.3 on a 3.00° path, the
 * FAA's Rate of Descent Table in the front of each Terminal Procedures
 * Publication (478 ft/min at 90 kt on 3.0°) and FAA-H-8083-16B, chapter 4.
 */
export function descentFpm(gsKt: number, angleDeg: number): number {
  return ((gsKt * FT_PER_NM) / 60) * Math.tan(rad(angleDeg));
}

/** A descent rate as a pilot sets it on the VSI: to the nearest 10 ft/min. */
export const roundedFpm = (fpm: number) => Math.round(fpm / 10) * 10;

/**
 * An airplane's approach category by its speed, 14 CFR 97.3: VREF, or
 * 1.3 × VSO where no VREF is specified, at the maximum certificated
 * landing weight -- A under 91 kt, B 91 to under 121, C 121 to under 141,
 * D 141 to under 166, E 166 and over. Null with neither speed.
 */
export function approachCategory(vrefKt: number | null | undefined, vsoKt?: number | null): "A" | "B" | "C" | "D" | "E" | null {
  const speed = vrefKt ?? (vsoKt != null ? 1.3 * vsoKt : null);
  if (speed == null || !(speed > 0)) return null;
  if (speed < 91) return "A";
  if (speed < 121) return "B";
  if (speed < 141) return "C";
  if (speed < 166) return "D";
  return "E";
}

/**
 * Which minimums an approach is flown to, by its kind (AIM 5-4-5 and
 * FAA-H-8083-16B, chapter 4): a decision altitude on a precision approach
 * (ILS, GLS) and on an RNP AR one; an RNAV (GPS) one's lines are a DA (LPV,
 * LNAV/VNAV) or an MDA (LNAV); every other a minimum descent altitude.
 */
export type MinimumsKind = "DA" | "MDA" | "DA or MDA";

export function minimumsKind(name: string): MinimumsKind {
  if (/^(ILS|GLS)\b/.test(name) || /^RNAV \(RNP\)/.test(name)) return "DA";
  if (/^(RNAV \(GPS\)|GPS\b)/.test(name)) return "DA or MDA";
  return "MDA";
}

/** A fix as said aloud: a runway's threshold ("RW08") by its runway. */
export function fixName(ident: string): string {
  const m = /^RW(\d{2}[LRC]?)$/.exec(ident);
  return m ? `the runway ${m[1]} threshold` : ident;
}

const has = (fix: Pick<ProcedureFix, "roles">, role: string) => fix.roles.includes(role);

/** The approach's own fixes in the order flown: its missed approach's left out. */
export function approachFixes(drawing: ProcedureDrawing): ProcedureFix[] {
  return drawing.fixes.filter(f => !f.missed);
}

/** The procedure's line in the order flown -- its transition, its final,
 *  then its missed approach -- each joint once. */
export function lessonPath(drawing: ProcedureDrawing): LatLon[] {
  const order: LessonSegment[] = ["transition", "final", "missed"];
  const path: LatLon[] = [];
  for (const role of order) {
    for (const line of drawing.lines.filter(l => l.role === role)) {
      for (const [lat, lon] of line.points) {
        const last = path.at(-1);
        if (!last || last.lat !== lat || last.lon !== lon) path.push({ lat: lat!, lon: lon! });
      }
    }
  }
  return path;
}

/** The point of `path` nearest `at`, from `from` on. */
function nearestFrom(path: LatLon[], at: LatLon, from: number): number {
  let best = from, bestNm = Infinity;
  for (let i = from; i < path.length; i++) {
    const nm = distanceNm(path[i]!, at);
    if (nm < bestNm) [best, bestNm] = [i, nm];
  }
  return best;
}

/** The procedure's line from `a` on to `b`, each end where it is: the way
 *  the lesson's airplane flies from one fix to the next. Straight between
 *  them where the line has no point near either. */
export function pathBetween(path: LatLon[], a: LatLon, b: LatLon): LatLon[] {
  if (path.length < 2) return [a, b];
  const i = nearestFrom(path, a, 0);
  const j = nearestFrom(path, b, i);
  return [a, ...path.slice(i + 1, j), b];
}

/** How far along `path` its point nearest `at` is, nm. */
export function alongNm(path: LatLon[], at: LatLon): number {
  const i = nearestFrom(path, at, 0);
  let nm = 0;
  for (let k = 1; k <= i; k++) nm += distanceNm(path[k - 1]!, path[k]!);
  return nm;
}

const turnWord = (turn: ProcedureMissedLeg["turn"]) => (turn === "L" ? "left" : turn === "R" ? "right" : null);

/** The altitude a missed approach's leg climbs to, as the plate says it. */
function climbWords(leg: ProcedureMissedLeg): string | null {
  const { min_ft: low, max_ft: high } = leg;
  if (low != null && high != null && low === high) return `at ${altFt(low)}`;
  if (low != null && high != null) return `to between ${altFt(low)} and ${altFt(high)}`;
  if (low != null) return `to ${altFt(low)}`;
  if (high != null) return `at or below ${altFt(high)}`;
  return null;
}

/** Legs flown on a heading, and on a course (ARINC 424-18 5.21). */
const HEADING_LEGS = new Set(["VA", "VD", "VI", "VM", "VR"]);
const HOLD_LEGS = new Set(["HM", "HA", "HF"]);

/** One leg of a missed approach in the plate's words, null for one these
 *  do not say (an arc, a procedure turn): the plate says it. */
function legWords(leg: ProcedureMissedLeg): string | null {
  const turn = turnWord(leg.turn);
  const climb = climbWords(leg);
  const dir = leg.course_deg != null ? `${HEADING_LEGS.has(leg.path) ? "heading" : "course"} ${bearing(leg.course_deg)}` : null;
  const fix = leg.fix ? fixName(leg.fix) : null;
  switch (leg.path) {
    case "CA": case "VA": case "FA":
      // "Climb to 3,000 on heading 093°"; with a turn, "climbing left turn".
      if (!climb && !dir) return null;
      return [turn ? `climbing ${turn} turn` : "climb", climb, dir && `on ${dir}`].filter(Boolean).join(" ");
    case "VI": case "CI":
      if (!dir) return null;
      return `${turn ? `${turn} turn to` : "fly"} ${dir} to intercept`;
    case "VM": case "FM":
      if (!dir) return null;
      return `${turn ? `${turn} turn to` : "fly"} ${dir} for radar vectors`;
    case "CF": case "TF": case "DF": {
      if (!fix) return null;
      const way = leg.path === "DF" ? `direct ${fix}` : leg.path === "CF" && dir ? `on ${dir} to ${fix}` : `to ${fix}`;
      return [turn ? `${turn} turn` : null, way, climb && `climbing ${climb}`].filter(Boolean).join(" ");
    }
    default:
      if (HOLD_LEGS.has(leg.path) && fix) {
        return [`hold at ${fix}`, turn && `${turn} turns`, leg.course_deg != null && `${bearing(leg.course_deg)} inbound`].filter(Boolean).join(", ");
      }
      return null;
  }
}

/** The missed approach as the plate's words say it, from its coded legs:
 *  "Climb to 1,800 on course 079°, then right turn to heading 210° to
 *  intercept, …, then hold at VTU, left turns, 131° inbound." Where a leg
 *  is one these words do not say, the rest is the plate's; null with none,
 *  or where the first is such a leg. */
export function missedWords(legs: ProcedureMissedLeg[] | undefined): string | null {
  if (!legs?.length) return null;
  const parts: string[] = [];
  for (const leg of legs) {
    const words = legWords(leg);
    if (words === null) {
      // Its first leg one these words do not say: all of it the plate's.
      if (parts.length === 0) return null;
      parts.push("as the plate shows");
      break;
    }
    parts.push(words);
  }
  const text = parts.join(", then ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** A time as a stopwatch says it: "2:05". */
export function stopwatch(seconds: number): string {
  const whole = Math.round(seconds);
  return stopwatchTime(whole);
}

/** The parts of the approach the lesson goes by. */
interface Parts {
  fixes: ProcedureFix[];
  faf: ProcedureFix | null;
  map: ProcedureFix | null;
  path: LatLon[];
  missed: string | null;
  minimums: MinimumsKind;
  /** Whether a procedure turn is drawn at a fix (vfr.procedures). */
  turnAt: (ident: string) => boolean;
}

function partsOf(drawing: ProcedureDrawing): Parts {
  const fixes = approachFixes(drawing);
  return {
    fixes,
    faf: fixes.find(f => has(f, "FAF")) ?? null,
    map: fixes.find(f => has(f, "MAP")) ?? null,
    path: lessonPath(drawing),
    missed: missedWords(drawing.missed_legs),
    minimums: minimumsKind(drawing.name),
    turnAt: ident => drawing.holds.some(h => h.fix === ident && h.kind === "procedure turn" && !h.missed),
  };
}

/** A fix's distance on to the missed approach point along the line, nm. */
function nmToMap(parts: Parts, fix: ProcedureFix): number | null {
  if (!parts.map) return null;
  return Math.max(0, alongNm(parts.path, parts.map) - alongNm(parts.path, fix));
}

/** What a fix is in the lesson's words, by the part it plays. */
function fixTitle(fix: ProcedureFix, afterFaf: boolean): string {
  if (has(fix, "IAF")) return "Initial Approach Fix";
  if (has(fix, "IF") || has(fix, "FACF")) return "Intermediate Fix";
  if (has(fix, "FAF")) return "Final Approach Fix";
  return afterFaf ? "Step-Down Fix" : "Transition Fix";
}

/** A fix's roles after its name, as a plate labels it: "SILEX (IAF)". */
function labelled(fix: ProcedureFix, start = false): string {
  const roles = fix.roles.filter(r => r !== "hold" && r !== "FACF");
  const name = fixName(fix.ident);
  const said = start ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
  return roles.length ? `${said} (${roles.join(", ")})` : said;
}

/** The crossing altitude in words, capitalised as a line of its own. */
function crossWords(fix: ProcedureFix): string {
  const words = altitudeLines(fix).words;
  return words ? `Cross ${words}` : `Altitude: ${SEE_THE_PLATE.toLowerCase()}`;
}

/** The field's radio a briefing calls, in its order: the weather, approach
 *  control, then the tower, or the CTAF at a field with none. */
export function briefFrequencies(frequencies: Frequency[] | null | undefined): string[] {
  if (!frequencies?.length) return [SEE_THE_PLATE];
  const lines: string[] = [];
  const say = (name: string, f: Frequency | null) => { if (f?.frequency_mhz != null) lines.push(`${name} ${mhzText(f.frequency_mhz)}`); };
  const weather = frequencyOf(frequencies, "ATIS", "AWOS", "ASOS");
  say((weather?.type ?? "ATIS").toUpperCase(), weather);
  const approach = frequencyOf(frequencies, "APP", "APCH", "A/D", "APP/DEP");
  if (approach) say("Approach", approach);
  else lines.push(`Approach: ${SEE_THE_PLATE.toLowerCase()}`);
  const tower = frequencyOf(frequencies, "TWR");
  if (tower) say("Tower", tower);
  else {
    // ctafOf falls back to MULTICOM's 122.9 where none is listed: that is
    // a guess at this field, so only one the field lists is briefed.
    const ctaf = ctafOf(frequencies);
    if (frequencies.includes(ctaf)) say("CTAF", ctaf);
  }
  return lines;
}

export interface BriefItem {
  key: string;
  title: string;
  lines: string[];
  focus: LessonFocus;
}

/**
 * The approach briefing, the way an instructor has a student brief it
 * before the approach (FAA-H-8083-16B, chapter 4, "Approach Briefing", in
 * the order of the plate's briefing strip and plan view): the procedure,
 * the radio, the final approach course, each fix and its altitude from the
 * IAF to the FAF, the minimums, the missed approach point and the missed
 * approach. Each shows its fix or its part on the map.
 */
export function approachBrief(input: LessonInput): BriefItem[] {
  const { drawing } = input;
  const parts = partsOf(drawing);
  const items: BriefItem[] = [];
  items.push({
    key: "approach", title: "The Approach",
    lines: [
      `${drawing.name} at ${drawing.airport}`,
      drawing.transition ? `From ${drawing.transition}` : "Vectors to final",
      ...(drawing.stale ? ["Out of date: these are an older cycle's data"] : []),
    ],
    focus: { fix: null, segment: null },
  });
  items.push({ key: "frequencies", title: "Frequencies", lines: briefFrequencies(input.frequencies), focus: { fix: null, segment: null } });
  items.push({
    key: "course", title: "Final Approach Course",
    lines: [
      drawing.final_course_deg != null ? `${bearing(drawing.final_course_deg)} magnetic` : SEE_THE_PLATE,
      ...(drawing.glidepath_deg != null ? [`Glidepath ${drawing.glidepath_deg.toFixed(2)}°`] : []),
    ],
    focus: { fix: null, segment: "final" },
  });
  let afterFaf = false;
  for (const fix of parts.fixes) {
    if (has(fix, "MAP")) continue;
    const lines = [labelled(fix, true), crossWords(fix)];
    if (parts.turnAt(fix.ident)) lines.push("Procedure turn here");
    else if (has(fix, "hold")) lines.push("Hold here as the plate shows");
    if (has(fix, "FAF")) {
      lines.push(drawing.glidepath_deg != null
        ? `Descend on the ${drawing.glidepath_deg.toFixed(2)}° path from here`
        : `Descend to the ${parts.minimums} from here`);
      const nm = nmToMap(parts, fix);
      if (nm != null && nm > 0) lines.push(`${nm.toFixed(1)} nm to the missed approach point`);
    }
    items.push({ key: `fix:${fix.ident}`, title: fixTitle(fix, afterFaf), lines, focus: { fix: fix.ident, segment: null } });
    if (has(fix, "FAF")) afterFaf = true;
  }
  const category = approachCategory(input.vrefKt, input.vsoKt);
  items.push({
    key: "minimums", title: "Minimums",
    lines: [
      parts.minimums === "DA or MDA" ? `DA (LPV, LNAV/VNAV) or MDA (LNAV): ${SEE_THE_PLATE.toLowerCase()}` : `${parts.minimums}: ${SEE_THE_PLATE.toLowerCase()}`,
      ...(category ? [`Category ${category}`] : []),
    ],
    focus: { fix: null, segment: "final" },
  });
  if (parts.map) {
    items.push({
      key: "map", title: "Missed Approach Point",
      lines: parts.minimums === "DA"
        ? ["At the decision altitude on the glidepath", `Coded at ${fixName(parts.map.ident)}`]
        : [labelled(parts.map, true)],
      focus: { fix: parts.map.ident, segment: null },
    });
  }
  items.push({ key: "missed", title: "Missed Approach", lines: [parts.missed ?? SEE_THE_PLATE], focus: { fix: null, segment: "missed" } });
  return items;
}

export interface CoachStep {
  key: string;
  title: string;
  /** What to do. */
  say: string;
  /** Why, or what to know as it is done. */
  why: string | null;
  /** Where the airplane is at the step: a fix, or the missed approach's end. */
  at: LatLon | null;
  focus: LessonFocus;
  /** The altitude the step's fix is crossed at, for the profile; null where
   *  none is coded (the minimums). */
  altitudeFt: number | null;
}

/** The altitude a fix is crossed at, as the profile draws it. */
const crossingFt = (fix: Pick<ProcedureFix, "min_ft" | "max_ft">) => fix.min_ft ?? fix.max_ft ?? null;

/**
 * The approach flown fix by fix with a word at each, at a ground speed of
 * `gsKt`: what to do crossing each fix, the descent on the published path
 * at that speed from the FAF and the time to the missed approach point, at
 * the minimums the decision -- land, or the missed approach in its own
 * words (14 CFR 91.175(c) and (e)) -- and then the missed approach flown.
 */
export function coachingSteps(input: LessonInput, gsKt: number): CoachStep[] {
  const { drawing } = input;
  const parts = partsOf(drawing);
  const steps: CoachStep[] = [];
  const at = (f: ProcedureFix): LatLon => ({ lat: f.lat, lon: f.lon });
  const course = drawing.final_course_deg != null ? bearing(drawing.final_course_deg) : null;
  const angle = drawing.glidepath_deg;
  const minimums = parts.minimums === "DA" ? "the DA" : parts.minimums === "MDA" ? "the MDA" : "the DA or MDA";
  const approachFixes = parts.fixes.filter(f => !has(f, "MAP"));
  const fafAt = approachFixes.findIndex(f => has(f, "FAF"));
  approachFixes.forEach((fix, i) => {
    const words = altitudeLines(fix).words;
    const crossing = `Cross ${fixName(fix.ident)}${words ? ` ${words}` : ""}`;
    // The next lower altitude the final steps down to, else the minimums.
    const nextDown = approachFixes.slice(i + 1).find(f => crossingFt(f) != null);
    const descendTo = nextDown ? `${altFt(crossingFt(nextDown))} at ${fixName(nextDown.ident)}` : `${minimums} (${SEE_THE_PLATE.toLowerCase()})`;
    let say: string, why: string | null;
    if (has(fix, "FAF")) {
      const rate = angle != null ? roundedFpm(descentFpm(gsKt, angle)) : null;
      say = angle != null
        ? `Descend on the ${angle.toFixed(2)}° path, about ${rate!.toLocaleString("en-US")} ft/min at ${gsKt} kt, and start the timer`
        : `Descend to ${descendTo} and start the timer`;
      const nm = nmToMap(parts, fix);
      why = `The final approach starts here.${nm != null && nm > 0 ? ` ${nm.toFixed(1)} nm to the missed approach point: ${stopwatch((nm / gsKt) * 3600)} at ${gsKt} kt.` : ""}`;
    } else if (fafAt >= 0 && i > fafAt) {
      say = `${crossing}, then descend to ${descendTo}`;
      why = "Not below this fix's altitude until it is passed.";
    } else if (has(fix, "IAF")) {
      say = parts.turnAt(fix.ident) ? `${crossing} and fly the procedure turn the plate shows` : crossing;
      why = "The approach begins here: hold each segment's altitude until its next fix.";
    } else if (has(fix, "IF") || has(fix, "FACF")) {
      say = course ? `${crossing} and turn onto the final approach course, ${course}` : crossing;
      // The intermediate segment positions the airplane for the final, its
      // speed and configuration set for it (FAA-H-8083-16B, chapter 4).
      why = "The intermediate segment lines you up and slows you to your approach speed before the final.";
    } else {
      say = words ? crossing : `Fly to ${fixName(fix.ident)}`;
      why = null;
    }
    steps.push({
      key: `fix:${fix.ident}`, title: `Crossing ${labelled(fix)}`, say: `${say}.`, why, at: at(fix),
      focus: { fix: fix.ident, segment: null }, altitudeFt: crossingFt(fix),
    });
  });
  const goMissed = parts.missed ?? "fly the missed approach the plate shows.";
  if (parts.map) {
    steps.push({
      key: "decision",
      title: parts.minimums === "DA" ? "At the Decision Altitude" : parts.minimums === "MDA" ? `At the Missed Approach Point` : "At the DA or Missed Approach Point",
      say: `Runway in sight? Land. Otherwise go missed: ${goMissed.charAt(0).toLowerCase()}${goMissed.slice(1)}`,
      // 14 CFR 91.175(c): below the DA or MDA only in a position to land
      // normally with the visibility and a runway reference in sight; (e):
      // the missed approach at once without them.
      why: "Below the minimums only with the runway environment in sight and in position to land; without it, the missed approach at once (14 CFR 91.175(c), (e)).",
      at: at(parts.map), focus: { fix: parts.map.ident, segment: "final" }, altitudeFt: null,
    });
  }
  const missedLine = drawing.lines.filter(l => l.role === "missed").at(-1);
  const end = missedLine?.points.at(-1);
  if (parts.missed && end) {
    const holdFix = [...(drawing.missed_legs ?? [])].reverse().find(l => l.fix)?.fix ?? null;
    steps.push({
      key: "missed", title: "Going Missed", say: parts.missed,
      // The standard missed approach climb gradient (FAA Order 8260.3),
      // as the dry run climbs it (navlog/dryRun MISSED_CLIMB_FT_PER_NM).
      why: "Climb at once: a missed approach is built for a climb of 200 ft a mile unless the plate asks for more (FAA Order 8260.3).",
      at: { lat: end[0]!, lon: end[1]! }, focus: { fix: holdFix, segment: "missed" }, altitudeFt: null,
    });
  }
  return steps;
}

/** A point of the approach's side view: a fix's distance along the line
 *  from the first and the altitude it is crossed at. */
export interface ProfileMark {
  ident: string;
  alongNm: number;
  ft: number | null;
  faf: boolean;
  map: boolean;
}

/**
 * The approach from the side, a sketch from the coded data: each of its
 * fixes at its distance along the line and the altitude it is crossed at,
 * and where a path angle is coded, the path down from the FAF's altitude at
 * that angle to the missed approach point (`path`), as the plate's profile
 * view draws it.
 */
export function lessonProfile(drawing: ProcedureDrawing): { marks: ProfileMark[]; path: { from: { nm: number; ft: number }; to: { nm: number; ft: number } } | null } {
  const parts = partsOf(drawing);
  const marks = parts.fixes.map(f => ({
    ident: f.ident, alongNm: alongNm(parts.path, f), ft: has(f, "MAP") ? null : crossingFt(f), faf: has(f, "FAF"), map: has(f, "MAP"),
  }));
  const faf = marks.find(m => m.faf);
  const map = marks.find(m => m.map);
  const angle = drawing.glidepath_deg;
  const path = faf && map && faf.ft != null && angle != null && map.alongNm > faf.alongNm
    ? { from: { nm: faf.alongNm, ft: faf.ft }, to: { nm: map.alongNm, ft: faf.ft - (map.alongNm - faf.alongNm) * FT_PER_NM * Math.tan(rad(angle)) } }
    : null;
  return { marks, path };
}

export interface QuizQuestion {
  key: string;
  prompt: string;
  choices: string[];
  /** The right choice's index. */
  answer: number;
  /** Where the answer is, said once a choice is made. */
  explain: string;
  focus: LessonFocus;
}

/** A string's hash, for each question's choices to be in an order of its own,
 *  the same each time it is asked. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A question from its answer and its wrong choices: the wrong ones each
 *  once, none the answer, at most three; none, no question. */
function question(key: string, prompt: string, answer: string, wrong: string[], explain: string, focus: LessonFocus): QuizQuestion | null {
  const others = [...new Set(wrong)].filter(w => w !== answer).slice(0, 3);
  if (others.length === 0) return null;
  const at = hash(key) % (others.length + 1);
  const choices = [...others.slice(0, at), answer, ...others.slice(at)];
  return { key, prompt, choices, answer: at, explain, focus };
}

/**
 * The lesson asked back, its answers hidden: multiple choice made from the
 * procedure's own data, each wrong choice another of its own values -- an
 * altitude another fix is crossed at, another fix, another course, the
 * descent rate at another ground speed -- so the right one is known only
 * by knowing the approach. Each answered says where it is.
 */
export function approachQuiz(input: LessonInput, gsKt: number): QuizQuestion[] {
  const { drawing } = input;
  const parts = partsOf(drawing);
  const out: (QuizQuestion | null)[] = [];
  const feet = (ft: number) => `${altFt(ft)} ft`;
  // Every altitude the procedure codes, for the wrong choices.
  const altitudes = [
    ...drawing.fixes.flatMap(f => [f.min_ft, f.max_ft]),
    ...(drawing.missed_legs ?? []).flatMap(l => [l.min_ft, l.max_ft]),
  ].filter((ft): ft is number => ft != null).map(feet);
  const idents = parts.fixes.map(f => f.ident);
  for (const fix of parts.fixes.filter(f => f.min_ft != null && (has(f, "IAF") || has(f, "IF") || has(f, "FACF") || has(f, "FAF")))) {
    out.push(question(
      `alt:${fix.ident}`, `What's the minimum altitude at ${fixName(fix.ident)}?`, feet(fix.min_ft!), altitudes,
      `${fixName(fix.ident)}: cross ${altitudeLines(fix).words}, on the plate's profile view and by the fix on the map.`,
      { fix: fix.ident, segment: null },
    ));
  }
  if (parts.faf) {
    out.push(question(
      "faf", "Which fix is the final approach fix?", parts.faf.ident, idents,
      `${parts.faf.ident}, marked FAF on the plate's profile view, ringed on the map.`, { fix: parts.faf.ident, segment: null },
    ));
  }
  if (drawing.final_course_deg != null) {
    const final = drawing.final_course_deg;
    out.push(question(
      "course", "What's the final approach course?", bearing(final),
      [bearing(final + 180), ...(drawing.missed_legs ?? []).flatMap(l => (l.course_deg != null ? [bearing(l.course_deg)] : []))],
      `${bearing(final)} magnetic, on the plate's plan view along the final, drawn over on the map.`, { fix: null, segment: "final" },
    ));
  }
  if (drawing.glidepath_deg != null) {
    const angle = drawing.glidepath_deg;
    const rate = (gs: number) => `${roundedFpm(descentFpm(gs, angle)).toLocaleString("en-US")} ft/min`;
    out.push(question(
      "descent", `On the ${angle.toFixed(2)}° path at ${gsKt} kt, about what descent rate?`, rate(gsKt),
      [60, 90, 120, 150].filter(gs => gs !== gsKt).map(rate),
      `About ${rate(gsKt)}: the ground speed × 101.3 × tan ${angle.toFixed(2)}°, as the TPP's rate of descent table gives it.`,
      { fix: parts.faf?.ident ?? null, segment: "final" },
    ));
  }
  if (parts.map) {
    const where = parts.minimums === "DA" ? "the decision altitude" : parts.minimums === "MDA" ? "the missed approach point" : "the DA or the missed approach point";
    out.push(question(
      "decision", `What do you do at ${where} without the runway in sight?`,
      parts.missed ? `Go missed: ${parts.missed.charAt(0).toLowerCase()}${parts.missed.slice(1)}` : "Go missed, as the plate shows",
      // The two a student most often gets wrong (14 CFR 91.175(c), (e)).
      ["Keep descending until the runway is in sight", "Circle over the field until the runway is in sight"],
      "The missed approach at once (14 CFR 91.175(e)), as the plate's briefing strip and profile say it; drawn dashed on the map.",
      { fix: parts.map.ident, segment: "missed" },
    ));
  }
  const holdFix = [...(drawing.missed_legs ?? [])].reverse().find(l => l.fix)?.fix;
  if (holdFix) {
    out.push(question(
      "missed-fix", "Where does the missed approach take you?", holdFix,
      [...idents, ...drawing.fixes.map(f => f.ident)].filter(i => !/^RW\d/.test(i)),
      `${holdFix}, at the end of the missed approach's dashed line on the plate and the map.`, { fix: holdFix, segment: "missed" },
    ));
  }
  return out.filter((q): q is QuizQuestion => q !== null);
}
