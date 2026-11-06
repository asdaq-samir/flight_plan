import { create } from "zustand";

/**
 * The map's Stops, opened from the Airport tab's Find Nearby (the map's
 * own Stops button gave its place to the radio's microphone at the
 * owner's ask, 2026-11-02): the sheet of the fields with fuel, food,
 * repair or flight training round the pilot or along the route over FPL
 * (StopsCard), its fields pinned on the chart (the owner, 2026-10-27; it
 * was Fly-in Food, and before that the stops along the route).
 */
export const useStopsAlong = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Where the card looks: along the route, or round the pilot; null as
   *  the route has it (along it where there is one). */
  scope: "route" | "near" | null;
  setScope: (scope: "route" | "near") => void;
  /** The field whose pin was tapped on the chart: its row picked in the
   *  card and brought into sight (the owner, 2026-10-28); none once the
   *  card is put away. */
  picked: string | null;
  setPicked: (ident: string | null) => void;
}>(set => ({
  open: false,
  setOpen: open => set(open ? { open } : { open, picked: null }),
  scope: null,
  setScope: scope => set({ scope }),
  picked: null,
  setPicked: picked => set({ picked }),
}));
