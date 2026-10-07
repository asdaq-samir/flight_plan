/**
 * The Brief's Go / No-Go: every tab's own finding about the flight in one
 * list, each a row that opens where it was found -- the weather, the
 * airspace on the route, the altitude, the fuel, the runways, the loading
 * and the risk -- and one line over them saying what they come to. What
 * the pilot reads first on opening the Brief, as a flight service
 * briefer starts with whether VFR is recommended (AIM 7-1-5(b)(2)).
 * The findings are the planner's; the decision is the pilot in command's
 * (14 CFR 91.3), and the line says so.
 */
import { create } from "zustand";
import { worstOf, type Finding } from "./status";

/** Where a finding is shown in full: a tab of the planning panel, and a
 *  section of it by its title. */
export interface Where {
  tab: "navlog" | "brief" | "weather" | "performance" | "airports";
  section?: string;
}

export interface VerdictItem extends Where {
  key: "weather" | "airspace" | "altitude" | "fuel" | "runways" | "balance" | "risk";
  label: string;
  finding: Finding;
  /** What was found, in a line. */
  detail: string;
}

export interface VerdictInput {
  weather: {
    /** The briefing is still being fetched, or failed (its words). */
    pending: boolean;
    failed: string | null;
    /** AIM 7-1-5's "VFR flight not recommended", its reasons. */
    vfrNotRecommended: string[];
    /** Under the pilot's own minimums (lib/minimums). */
    underMinimums: string[];
    /** The SIGMETs and G-AIRMETs along the route, by name. */
    hazards: string[];
    /** The sources that did not answer, by name. */
    unchecked: string[];
    /** The worst the forecast says along the route, in words. */
    worst: string | null;
  };
  airspace: {
    pending: boolean;
    /** tfr.faa.gov did not answer. */
    unchecked: boolean;
    /** TFRs the route goes through while in force when it gets there. */
    inForce: string[];
    /** TFRs near the route that are not. */
    near: number;
    /** Special-use areas the legs cross, as their times of use read for
     *  the pass (lib/passTimes). */
    specialUse: { name: string; when: "active" | "not-scheduled" | "by-notam" | "unknown" }[];
  };
  altitude: {
    pending: boolean;
    /** No VFR altitude fits, in a line. */
    problem: string | null;
    /** A pilot's own altitude's broken rules (AltitudeCaution). */
    cautions: string[];
    /** The altitude flown, as the FL chip says it. */
    flown: string | null;
  };
  fuel: {
    pending: boolean;
    /** The least the tanks hold over the fuel and its reserve, any flight
     *  of the route; null where the usable fuel is not known. */
    marginGal: number | null;
    requiredGal: number | null;
    reserveMin: number | null;
  };
  runways: {
    pending: boolean;
    /** Not worked out: no POH tables for this airplane. */
    worked: boolean;
    short: string[];
    crosswind: string[];
  };
  balance: {
    pending: boolean;
    worked: boolean;
    problems: string[];
    takeoff: string | null;
  };
  risk: { level: "low" | "caution" | "high"; line: string } | null;
}

const RISK_FINDING = { low: "ok", caution: "caution", high: "stop" } as const;
const one = (n: number) => Math.round(n * 10) / 10;

/** Each tab's finding, in the order a pilot goes through them. */
export function verdictItems(input: VerdictInput): VerdictItem[] {
  const { weather, airspace, altitude, fuel, runways, balance, risk } = input;
  const items: VerdictItem[] = [];

  items.push({
    key: "weather", label: "Weather", tab: "weather", section: "Adverse Conditions",
    ...(weather.failed ? { finding: "unknown", detail: `Not fetched: ${weather.failed}` }
      : weather.pending ? { finding: "pending", detail: "Fetching METARs, TAFs and hazards…" }
        : weather.vfrNotRecommended.length ? { finding: "stop", detail: `VFR not recommended: ${weather.vfrNotRecommended[0]}` }
          : weather.underMinimums.length ? { finding: "stop", detail: `Under your minimums: ${weather.underMinimums[0]}` }
            : weather.hazards.length ? { finding: "caution", detail: `${weather.hazards.join(", ")} along the route` }
              : weather.unchecked.length ? { finding: "caution", detail: `Not checked: ${weather.unchecked.join(", ")}` }
                : { finding: "ok", detail: weather.worst ? `No hazards; at worst ${weather.worst}` : "No hazards along the route" }),
  });

  const activeArea = airspace.specialUse.find(a => a.when === "active");
  const maybeArea = airspace.specialUse.find(a => a.when === "by-notam" || a.when === "unknown");
  items.push({
    key: "airspace", label: "TFRs & special use", tab: "brief", section: "TFRs & Special Use",
    ...(airspace.pending ? { finding: "pending", detail: "Checking TFRs along the route…" }
      : airspace.inForce.length ? { finding: "stop", detail: `TFR ${airspace.inForce[0]} in force when you get there` }
        : airspace.unchecked ? { finding: "caution", detail: "Not checked: see tfr.faa.gov" }
          : activeArea ? { finding: "caution", detail: `${activeArea.name} scheduled in use when you pass` }
            : maybeArea ? { finding: "caution", detail: `${maybeArea.name}: ask whether it is active` }
              : {
                finding: "ok",
                detail: airspace.near || airspace.specialUse.length
                  ? [airspace.near && `${airspace.near} TFR${airspace.near === 1 ? "" : "s"} near, none in force on the route`,
                    airspace.specialUse.length && `${airspace.specialUse.length} special-use area${airspace.specialUse.length === 1 ? "" : "s"} not scheduled then`]
                    .filter(Boolean).join("; ")
                  : "None on the route",
              }),
  });

  items.push({
    key: "altitude", label: "Altitude", tab: "navlog",
    ...(altitude.problem ? { finding: "stop", detail: altitude.problem }
      : altitude.pending ? { finding: "pending", detail: "Planning altitudes…" }
        : altitude.cautions.length ? { finding: "caution", detail: altitude.cautions[0]! }
          : { finding: "ok", detail: altitude.flown ?? "Planned" }),
  });

  items.push({
    key: "fuel", label: "Fuel", tab: "navlog",
    ...(fuel.pending ? { finding: "pending", detail: "Working out the fuel…" }
      : fuel.marginGal != null && fuel.marginGal < 0
        ? { finding: "stop", detail: `${one(-fuel.marginGal)} gal short of the fuel and its ${fuel.reserveMin ?? 30} min reserve (14 CFR 91.151)` }
        : fuel.marginGal == null
          ? { finding: "unknown", detail: fuel.requiredGal != null ? `${one(fuel.requiredGal)} gal needed; the tanks' usable fuel not known` : "Not worked out" }
          : { finding: "ok", detail: `Needs ${one(fuel.requiredGal ?? 0)} gal with taxi and a ${fuel.reserveMin ?? 30} min reserve; ${one(fuel.marginGal)} gal spare` }),
  });

  items.push({
    key: "runways", label: "Runways", tab: "performance", section: "Takeoff & Landing",
    ...(!runways.worked ? { finding: "unknown", detail: "Not worked out for this airplane" }
      : runways.pending ? { finding: "pending", detail: "Waiting on the runways and the weather…" }
        : runways.short.length ? { finding: "stop", detail: `Too short at ${runways.short.join(", ")}` }
          : runways.crosswind.length ? { finding: "caution", detail: `Crosswind past the POH's demonstrated at ${runways.crosswind.join(", ")}` }
            : { finding: "ok", detail: "Takeoff and landing within each runway" }),
  });

  items.push({
    key: "balance", label: "Weight & balance", tab: "performance", section: "Weight & Balance",
    ...(balance.pending ? { finding: "pending", detail: "Waiting on the airplane's profile…" }
      : !balance.worked ? { finding: "unknown", detail: "Not worked out for this airplane" }
      : balance.problems.length ? { finding: "stop", detail: balance.problems[0]! }
        : { finding: "ok", detail: balance.takeoff ? `${balance.takeoff}, within limits` : "Within limits" }),
  });

  items.push({
    key: "risk", label: "Risk", tab: "brief", section: "Risk Assessment",
    ...(risk ? { finding: RISK_FINDING[risk.level], detail: risk.line } : { finding: "pending", detail: "Waiting on the briefing…" }),
  });

  return items;
}

/** What the findings come to, in a line over them. */
export function verdictLine(items: VerdictItem[]): { finding: Finding; words: string } {
  const finding = worstOf(items.map(i => i.finding));
  const named = (f: Finding) => items.filter(i => i.finding === f).map(i => i.label).join(", ");
  switch (finding) {
    case "stop": return { finding, words: `No-go as planned: ${named("stop")}` };
    case "caution": return { finding, words: `Look again at ${named("caution")}` };
    case "unknown": return { finding, words: `Nothing found against it; not worked out: ${named("unknown")}` };
    case "pending": return { finding, words: `Still checking: ${named("pending")}` };
    default: return { finding, words: "Nothing found against this flight" };
  }
}

/** The findings for the flight on screen, published once (as the risk
 *  is, lib/frat) for the tabs' marks. */
export const useVerdict = create<{ items: VerdictItem[]; setItems: (items: VerdictItem[]) => void }>(set => ({
  items: [],
  setItems: items => set({ items }),
}));
