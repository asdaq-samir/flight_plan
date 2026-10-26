import { create } from "zustand";

/**
 * The map's fly-in food: a button among the map's own (StopsAlongButton,
 * `available`), which opens the card of the fields near the pilot with
 * food a walk from the ramp over FPL (FoodCard), its fields pinned on the
 * chart (the owner, 2026-10-25; it was the stops along the route).
 */
export const useStopsAlong = create<{
  available: boolean;
  open: boolean;
  /** The planner's own opening of the card -- FPL in sight, the other
   *  cards put away -- for the map's button (PlanWorkspace's openStops). */
  opener: (() => void) | null;
  setOpener: (opener: (() => void) | null) => void;
  setAvailable: (available: boolean) => void;
  setOpen: (open: boolean) => void;
  /** Where the card looks: along the route, or round the pilot; null as
   *  the route has it (along it where there is one). */
  scope: "route" | "near" | null;
  setScope: (scope: "route" | "near") => void;
}>(set => ({
  available: false,
  open: false,
  opener: null,
  setOpener: opener => set({ opener }),
  setAvailable: available => set(available ? { available } : { available, open: false }),
  setOpen: open => set({ open }),
  scope: null,
  setScope: scope => set({ scope }),
}));
