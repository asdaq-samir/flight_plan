/**
 * What Wingtip Maps is and is not, in one place: the words the first-launch
 * acknowledgement, Settings' About & limits and the briefing's foot all
 * say, so they cannot drift apart. The pilot in command's authority and the
 * preflight duty are 14 CFR 91.3 and 91.103; the official briefing is
 * Flight Service's (1800wxbrief.com, 1-800-WX-BRIEF).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const LIMITS =
  "Wingtip Maps is a planning aid for VFR flight. It does not replace an official weather briefing (1800wxbrief.com or 1-800-WX-BRIEF), current FAA charts and publications, or the pilot in command’s judgement and final authority (14 CFR 91.3, 91.103). Its checkpoints are a model’s suggestions: check them against the chart.";

/** Where the planner's data comes from, as the README states it. */
export const DATA_SOURCES = [
  "FAA VFR sectional and terminal area charts",
  "FAA airport, airspace and obstacle data",
  "NOAA winds aloft and magnetic declination",
  "aviationweather.gov METARs, TAFs and SIGMETs",
  "OpenStreetMap, for checkpoint candidates",
];

/** The first-launch acknowledgement, remembered on this device. */
export const useAcknowledged = create<{
  acknowledged: boolean;
  acknowledge: () => void;
}>()(persist(set => ({
  acknowledged: false,
  acknowledge: () => set({ acknowledged: true }),
}), { name: "vfr.limits" }));
