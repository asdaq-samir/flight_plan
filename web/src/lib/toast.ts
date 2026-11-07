import { useSyncExternalStore, type ReactNode } from "react";
import type { ExternalToast } from "sonner";

/**
 * sonner's `toast`, with sonner itself fetched on the first toast rather
 * than in the first load: imported anywhere the page draws first, it kept
 * its 34 KB in the script every phone runs before the map shows (issue
 * #290), for banners that come only once the pilot has done something.
 * The calls are sonner's own, made once its chunk is in hand, in the
 * order they were made; AppToaster mounts the Toaster then, which shows
 * the toasts made before it subscribed (sonner replays the active ones).
 *
 * Only what the app calls: a toast, success, loading and dismiss.
 */
type Sonner = typeof import("sonner");
type Message = (() => ReactNode) | ReactNode;

let sonner: Promise<Sonner> | null = null;
const listeners = new Set<() => void>();

/** sonner, asked for once; AppToaster mounts its Toaster from then on. */
export function loadToasts(): Promise<Sonner> {
  if (!sonner) {
    sonner = import("sonner");
    listeners.forEach(listener => listener());
  }
  return sonner;
}

/** Whether sonner has been asked for, for AppToaster. */
export function useToastsWanted(): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => sonner != null,
  );
}

const later = (call: (t: Sonner["toast"]) => void) => {
  void loadToasts().then(m => call(m.toast));
};

function show(message: Message, data?: ExternalToast) {
  later(t => t(message, data));
}

export const toast = Object.assign(show, {
  success(message: Message, data?: ExternalToast) { later(t => t.success(message, data)); },
  loading(message: Message, data?: ExternalToast) { later(t => t.loading(message, data)); },
  /** Nothing to take down before sonner was ever asked for. */
  dismiss(id?: string | number) { if (sonner) later(t => t.dismiss(id)); },
});
