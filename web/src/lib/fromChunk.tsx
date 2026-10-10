import { lazy, useState, type ComponentType } from "react";

/**
 * A component on a chunk of its own, drawn straight from its module once
 * the module is in hand, and through React's `lazy` only until then. A
 * component under `lazy` alone suspends the first time it is drawn even
 * with its chunk long fetched (the factory's promise settles a tick
 * later), and React holds back the content of a Suspense boundary that
 * has just shown its fallback for 300 ms (FALLBACK_THROTTLE_MS): the
 * gear's console, its chunk fetched seconds before, still took a third
 * of a second longer to show its tabs the first time it was opened.
 * `prefetch` asks for the chunk ahead of it being drawn.
 *
 * Which one a part is drawn as is decided once, as it is first drawn: a
 * part switched to the module's own component once the chunk came would
 * be a new component from nothing, its state lost.
 */
export function fromChunk<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>) {
  let loaded: M | null = null;
  const fetch = () => load().then(module => (loaded = module));
  const Waited = lazy(() => fetch().then(module => ({ default: pick(module) })));
  function Part(props: P) {
    const [Drawn] = useState(() => (loaded ? pick(loaded) : Waited));
    return <Drawn {...props} />;
  }
  return { Part, prefetch: () => void fetch().catch(() => {}) };
}
