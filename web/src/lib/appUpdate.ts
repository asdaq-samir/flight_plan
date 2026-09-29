import { create } from "zustand";

/**
 * A new build of the app, waiting: the service worker has it installed
 * (main.tsx's `registerSW`) and applies it on `reload`. Offered as a
 * toast at first, and, once the pilot has put that away, kept as a small
 * pill at the bottom of the page rather than dropped -- a version that
 * is ready stays offered until it is taken or the page is opened fresh.
 */
interface AppUpdate {
  /** Applies the waiting build and reloads; null until one is waiting. */
  reload: ((reloadPage?: boolean) => Promise<void>) | null;
  /** Whether the offer is folded to the pill. */
  minimized: boolean;
  /** Whether Reload has been pressed: the page is on its way out, and
   *  the toast's own dismissal must not fold it to the pill. */
  reloading: boolean;
  ready: (reload: AppUpdate["reload"]) => void;
  minimize: () => void;
  expand: () => void;
  apply: () => void;
}

export const useAppUpdate = create<AppUpdate>((set, get) => ({
  reload: null,
  minimized: false,
  reloading: false,
  ready: reload => set({ reload, minimized: false, reloading: false }),
  minimize: () => { if (!get().reloading) set({ minimized: true }); },
  expand: () => set({ minimized: false }),
  apply: () => {
    const { reload } = get();
    if (!reload) return;
    set({ reloading: true });
    void reload(true);
  },
}));
