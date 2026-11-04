/**
 * The Brief's glance: each part of the flight in two or three figures, a
 * card each over its page, at the owner's pick of the redesign (D′,
 * 2026-10-22: "that new D looks fine for Brief") -- before you go (the
 * risk, the fuel to spare, the loading), the departure (its weather, the
 * runway, the takeoff over 50 ft, the frequency first called), en route
 * (the lowest ceiling and visibility forecast, the wind aloft) and the
 * arrival (as the departure, with the landing). Worked out where the
 * briefing works out the pages' own (FlightBriefingView, the instance
 * that publishes), and published here, as the Go / No-Go is (lib/verdict).
 */
import { create } from "zustand";
import type { Finding } from "./status";
import type { VerdictItem } from "./verdict";

/** A field's: the departure's, or the destination's. */
export interface FieldGlance {
  ident: string;
  /** Its flight category for when the flight is there (the TAF's, or the
   *  nearest one's), else the METAR's; null where neither says. */
  category: string | null;
  /** When it leaves or lands, ISO. */
  at: string | null;
  /** The runway flown ("24"), its length, and the takeoff or landing over
   *  a 50 ft obstacle on it (lib/runwayCheck). */
  runway: string | null;
  runwayFt: number | null;
  overFiftyFt: number | null;
  /** The wind reported there, in words ("090° 6 kt", "Calm"). */
  wind: string | null;
  /** The crosswind on that runway, the gusts' where more (lib/runwayCheck). */
  crosswindKt: number | null;
  /** The first station called or listened to there (lib/radio). */
  radio: { to: string; mhz: number } | null;
  finding: Finding;
}

export interface BriefGlance {
  before: {
    risk: { score: number; level: "low" | "caution" | "high" } | null;
    /** The least the tanks hold over the fuel and its reserve, gallons. */
    spareGal: number | null;
    /** Within its limits, or what is not. */
    balance: { within: boolean; problem: string | null } | null;
    finding: Finding;
  };
  depart: FieldGlance | null;
  enroute: {
    /** The lowest ceiling and visibility forecast along the route. */
    ceilingFt: number | null;
    visibilitySm: number | null;
    /** The first stretch's wind aloft, in words ("350°/8"). */
    wind: string | null;
    eteMin: number | null;
    /** Its finding, in a line (the weather's on the Go / No-Go). */
    line: string | null;
    finding: Finding;
  };
  arrive: FieldGlance | null;
  /** The reports the briefing holds as sent, for a finding's sources: the
   *  METARs and TAFs at the fields, and the TFRs by their NOTAM. */
  raw: { metars: { ident: string; raw: string }[]; tafs: { ident: string; raw: string }[]; tfrs: string[] };
}

export const useGlance = create<{ glance: BriefGlance | null; set: (glance: BriefGlance | null) => void }>(set => ({
  glance: null,
  set: glance => set({ glance }),
}));

/** A line of the Brief as it opens: a finding with what to do about it,
 *  in one sentence, and under a tap why it matters, with the rule it
 *  comes from, and the reports it was read from. */
export interface GlanceLine {
  key: VerdictItem["key"];
  finding: Finding;
  tab: VerdictItem["tab"];
  section?: string;
  /** The finding and its action, one sentence of at most LINE_MAX characters. */
  line: string;
  why: string;
  cite: string;
  raw: string[];
}

/** The most a line a pilot reads before flying may run: one sentence, two
 *  rows of an iPhone at the body size (the owner's rule, 2026-11-03: "make
 *  it simpler for them to just look and go"). */
export const LINE_MAX = 140;
/** The most lines a pilot acts on before the rest fold away. */
export const LINES_MAX = 3;

/** Why each finding matters, in plain words, and the rule it rests on.
 *  Explanations of the engine's findings, not rules of their own: the
 *  figures and the findings are the engine's (native/engine gonogo). */
const WHY: Record<VerdictItem["key"], { why: string; cite: string }> = {
  weather: {
    why: "VFR needs 14 CFR 91.155's visibility and distance from clouds all the way; a briefer's \"VFR not recommended\" (AIM 7-1-5) means the forecast is under them somewhere on the route, and your own minimums are stricter still.",
    cite: "14 CFR 91.155; AIM 7-1-5",
  },
  airspace: {
    why: "A TFR is airspace closed by NOTAM, and flying through one in force breaks 14 CFR 91.137 (or 91.141 round the President); a restricted area in use is closed under 91.133, and a MOA can be busy with no NOTAM at all.",
    cite: "14 CFR 91.133, 91.137, 91.141",
  },
  altitude: {
    why: "Above 3,000 ft AGL a VFR cruise follows the hemispheric rule (14 CFR 91.159), 91.119 sets the least height over terrain and people, and the altitude must keep 91.155's distance from the clouds.",
    cite: "14 CFR 91.119, 91.155, 91.159",
  },
  fuel: {
    why: "A VFR flight must land with fuel for 30 more minutes by day and 45 at night (14 CFR 91.151); under IFR it is fuel to the alternate and 45 minutes more (91.167). Running the tanks to the reserve is a no-go, not a margin.",
    cite: "14 CFR 91.151, 91.167",
  },
  runways: {
    why: "The POH's demonstrated crosswind is what the test pilot showed, not a limit, but past it nothing was shown for your airplane; the takeoff and landing distances are its tables', which 14 CFR 91.103(b) asks you to work out before you go.",
    cite: "14 CFR 91.103(b); the POH",
  },
  balance: {
    why: "Outside the envelope the airplane may not climb, or may not answer the controls; 14 CFR 91.9 forbids flying outside the flight manual's limits, and 91.103(b) asks you to work the loading out first.",
    cite: "14 CFR 91.9, 91.103(b)",
  },
  risk: {
    why: "The risk assessment follows the FAA's PAVE and IMSAFE checklists (Risk Management Handbook, FAA-H-8083-2): the points are the planner's guide, and the decision is yours as pilot in command under 14 CFR 91.3.",
    cite: "FAA-H-8083-2; 14 CFR 91.3",
  },
};

/** What to do about a finding, by its key and whether it stops the flight. */
const ACTION: Record<VerdictItem["key"], { stop: string; caution: string }> = {
  weather: { stop: "wait for it to lift, or plan another day", caution: "read it on En route and plan around it" },
  airspace: { stop: "route around it, or go later", caution: "call Flight Service (1-800-WX-BRIEF) before you go" },
  altitude: { stop: "pick another altitude or route", caution: "pick an altitude the wheel offers" },
  fuel: { stop: "add fuel, or plan a stop", caution: "add fuel, or plan a stop" },
  runways: { stop: "pick a longer runway, or a lighter load", caution: "ask for another runway, or wait for the wind" },
  balance: { stop: "move or leave some weight", caution: "move or leave some weight" },
  risk: { stop: "talk it over with your instructor before you go", caution: "tick the risk assessment and look at its factors" },
};

/** A line's lead and its action in one sentence of at most LINE_MAX
 *  characters, the lead cut short with an ellipsis where it must be. */
function sentence(lead: string, action: string): string {
  const head = lead.replace(/[.;:,\s]+$/, "");
  const room = LINE_MAX - action.length - 2;
  const cut = head.length > room ? `${head.slice(0, room - 1).trimEnd()}…` : head;
  return `${cut}: ${action}`;
}

/** The crosswind finding in the figures the glance already has: each
 *  field's runway and the knots across it, else the engine's own words. */
function crosswindLead(detail: string, glance: BriefGlance | null): string {
  const fields = [glance?.depart, glance?.arrive].filter((f): f is FieldGlance => !!f && f.finding === "caution" && f.crosswindKt != null);
  if (!fields.length) return detail;
  const each = fields.map(f => `${f.runway ? `Runway ${f.runway} at ` : ""}${f.ident} has ${f.crosswindKt} kt across`);
  return `${each.join(", ")}, past the POH's demonstrated`;
}

/** The lead of a line, from the engine's detail: the key's own words where
 *  the glance has the figures, else the detail as the engine wrote it. */
function lead(item: VerdictItem, glance: BriefGlance | null): string {
  if (item.key === "runways" && item.finding === "caution") return crosswindLead(item.detail, glance);
  return item.detail;
}

/** The reports a finding was read from, as sent. */
function sources(key: VerdictItem["key"], glance: BriefGlance | null): string[] {
  const raw = glance?.raw;
  if (!raw) return [];
  if (key === "weather") return [...raw.metars.map(m => m.raw), ...raw.tafs.map(t => t.raw)];
  if (key === "runways") return raw.metars.map(m => m.raw);
  if (key === "airspace") return raw.tfrs;
  return [];
}

export interface GlanceLines {
  /** The lines a pilot acts on, the stops before the cautions, at most LINES_MAX. */
  act: GlanceLine[];
  /** The rest, folded into one row. */
  rest: { line: string; finding: Finding; items: VerdictItem[] };
}

/**
 * The Brief's lines as it opens (the owner's rule, 2026-11-03: a pilot
 * "doesn't want to spend too much time in studying the briefs"): each
 * finding that stops the flight or wants a look as one sentence with what
 * to do about it, the stops first, at most LINES_MAX of them, and every
 * other finding folded into one row -- "Everything else is fine", or how
 * many more there are to look at. Each line is at most LINE_MAX
 * characters (glance.test.ts). The findings and their figures are the
 * engine's (lib/verdict); only the words round them are made here.
 */
export function glanceLines(items: VerdictItem[], glance: BriefGlance | null): GlanceLines {
  const acted = [...items.filter(i => i.finding === "stop"), ...items.filter(i => i.finding === "caution")];
  const act = acted.slice(0, LINES_MAX).map(i => ({
    key: i.key, finding: i.finding, tab: i.tab, section: i.section,
    line: sentence(lead(i, glance), ACTION[i.key][i.finding === "stop" ? "stop" : "caution"]),
    why: WHY[i.key].why, cite: WHY[i.key].cite, raw: sources(i.key, glance),
  }));
  const rest = items.filter(i => !acted.slice(0, LINES_MAX).includes(i));
  const more = rest.filter(i => i.finding !== "ok");
  const pending = rest.filter(i => i.finding === "pending");
  const line = !rest.length ? ""
    : pending.length ? `Still checking ${pending.map(i => i.label.toLowerCase()).join(", ")}`
    : more.length ? `${more.length} more to look at`
    : sentence(`${rest.map(i => i.label.toLowerCase()).join(", ")}`.replace(/^./, c => c.toUpperCase()), "nothing to fix");
  const finding: Finding = pending.length ? "pending" : more.some(i => i.finding === "stop" || i.finding === "caution") ? "caution" : more.length ? "unknown" : "ok";
  return { act, rest: { line, finding, items: rest } };
}
