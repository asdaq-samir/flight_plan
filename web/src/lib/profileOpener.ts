import { create } from "zustand";

/** The route's Profile opened from where the page cannot hand it down --
 *  the altitude's caution dot (AltitudeGroup) -- as the route's ••• menu
 *  opens it: the page's own opener (PlanWorkspace), null with no route to
 *  draw it for. The map's Play opened it before, and was taken off the map
 *  at the owner's ask (2026-11-02: "I don't want the play button there,
 *  just the mic"). */
export const useProfileOpener = create<{ open: (() => void) | null }>(() => ({ open: null }));
