import { create } from "zustand";

/** Whether FPL's route line is unfolded (ProceduresRoute's RouteLine): the
 *  map draws the chips' ways beside the course while it is. Here, not in
 *  the route's list: the page reads it, and the list is loaded later. */
export const useRouteLineOpen = create<{ open: boolean }>(() => ({ open: false }));
