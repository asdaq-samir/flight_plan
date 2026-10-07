/**
 * Preflight action, 14 CFR 91.103: before a flight the pilot in command
 * becomes familiar with all available information about it -- for a
 * flight not in the vicinity of an airport, the weather reports and
 * forecasts, the fuel requirements, the alternatives if the flight cannot
 * be completed and any known ATC delays (91.103(a)); for any flight, the
 * runway lengths at the airports of intended use and the takeoff and
 * landing distances (91.103(b)). NOTAMs are among "all available
 * information": the time-critical news charts cannot carry (AIM 5-1-3).
 * In the order pilots learn them by (NWKRAFT); a list the pilot ticks
 * off on the Brief, each item with what the planner found for it.
 */
import { create } from "zustand";
import type { Where } from "./verdict";

export interface PreflightItem extends Where {
  key: string;
  title: string;
  /** The rule that asks for it. */
  rule: string;
}

export const PREFLIGHT_ITEMS: PreflightItem[] = [
  { key: "notams", title: "NOTAMs", rule: "91.103: all available information", tab: "brief", section: "TFRs & Special Use" },
  { key: "weather", title: "Weather reports and forecasts", rule: "91.103(a)", tab: "weather" },
  { key: "delays", title: "Known ATC delays", rule: "91.103(a)", tab: "brief" },
  { key: "runways", title: "Runway lengths at each airport", rule: "91.103(b)", tab: "airports" },
  { key: "alternatives", title: "Alternatives if the flight cannot be completed", rule: "91.103(a)", tab: "navlog" },
  { key: "fuel", title: "Fuel requirements", rule: "91.103(a), 91.151", tab: "navlog" },
  { key: "distances", title: "Takeoff and landing distances", rule: "91.103(b)", tab: "performance", section: "Takeoff & Landing" },
];

const NONE: Record<string, boolean> = {};

/**
 * What the pilot has ticked, for one flight: another route or departure
 * time starts the list again -- it is about this flight, where the risk
 * assessment's IMSAFE is about the pilot today and stays (lib/frat).
 */
export const usePreflight = create<{
  flight: string;
  ticked: Record<string, boolean>;
  tick: (flight: string, key: string, on: boolean) => void;
}>(set => ({
  flight: "",
  ticked: NONE,
  tick: (flight, key, on) => set(s => ({ flight, ticked: { ...(s.flight === flight ? s.ticked : NONE), [key]: on } })),
}));

/** The ticks for `flight`: none when another flight's are kept. */
export const useTicked = (flight: string) => usePreflight(s => (s.flight === flight ? s.ticked : NONE));
