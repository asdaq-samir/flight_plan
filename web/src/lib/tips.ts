/**
 * First-run tips, as iOS's TipKit offers them: one at a time, beside the
 * control it is about, once that control is in sight -- what a pilot new
 * to the planner should look for, said once and remembered on this
 * device. Settings, Tips brings them back.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TipSpec {
  /** The control's `data-tip`. */
  id: string;
  title: string;
  message: string;
}

/** In the order they are offered, each when its control is in sight. */
export const TIPS: TipSpec[] = [
  {
    id: "route", title: "Your route",
    message: "Type an airport or a waypoint at any arrow. Drag a point to move it; press and hold one to set its altitude or remove it.",
  },
  {
    id: "flight-line", title: "The quick numbers",
    message: "Distance, arrival time and fuel, worked out as you plan. Pull the panel up past the line for the detail.",
  },
  {
    id: "altitude", title: "Why this altitude",
    message: "Tap the altitude to see how it was chosen, or pick another plan. Red means no VFR altitude fits; a dot, a rule to check.",
  },
  {
    id: "tabs", title: "Dots mean look here",
    message: "A red dot on a tab marks something to fix before you go; an amber one, something to look at.",
  },
  {
    id: "verdict", title: "Start with Go / No-Go",
    message: "Every tab's findings in one list. Tap one to see it in full. The decision stays yours as pilot in command.",
  },
  {
    id: "weather-places", title: "Weather when you are there",
    message: "Each place along the route, its forecast read for the hour you pass it, from the departure to the destination.",
  },
];

/** Seen, every one: what a device that has turned them off keeps. */
const ALL_SEEN = "*";

export const useTips = create<{
  seen: string[];
  see: (id: string) => void;
  reset: () => void;
}>()(persist(set => ({
  seen: [],
  see: id => set(s => (s.seen.includes(id) ? s : { seen: [...s.seen, id] })),
  reset: () => set({ seen: [] }),
}), { name: "vfr.tips" }));

/** Whether a tip is still to be offered. */
export const unseen = (seen: string[], id: string) => !seen.includes(ALL_SEEN) && !seen.includes(id);
