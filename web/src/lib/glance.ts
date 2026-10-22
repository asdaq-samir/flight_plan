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
}

export const useGlance = create<{ glance: BriefGlance | null; set: (glance: BriefGlance | null) => void }>(set => ({
  glance: null,
  set: glance => set({ glance }),
}));
