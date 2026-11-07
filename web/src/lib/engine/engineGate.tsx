import { useSyncExternalStore, type ReactNode } from "react";
import { engineLoaded, engineReady } from "./engine";

// Told once the engine is there; nothing to take back, since it never
// unloads.
const subscribe = (changed: () => void) => {
  let live = true;
  void engineReady.then(() => { if (live) changed(); });
  return () => { live = false; };
};

/** Whether the shared engine (lib/engine) can answer now: false while its
 *  .wasm is still coming, true from then on. */
export function useEngineReady(): boolean {
  return useSyncExternalStore(subscribe, engineLoaded, engineLoaded);
}

/**
 * What asks the engine while it renders, drawn only once the engine is
 * there, and `fallback` in its place until then: so the page's shell
 * paints without waiting for the .wasm (main.tsx), and `callEngine` can
 * stay synchronous for everything drawn inside.
 */
export function EngineGate({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  return useEngineReady() ? children : fallback;
}
