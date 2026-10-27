import { create } from "zustand";

/** The map's Play button (DryRunButton), the dry run of the route on its
 *  profile, at the owner's ask (2026-10-27: the profile's button "would be
 *  the profile demo button" on the map, above Stops): whether there is a
 *  route ready to fly, whether it is flying, and the page's own start and
 *  stop (PlanWorkspace), as the Stops button's opener is. */
export const useDryRunButton = create<{
  ready: boolean;
  flying: boolean;
  play: (() => void) | null;
  stop: (() => void) | null;
}>(() => ({ ready: false, flying: false, play: null, stop: null }));
