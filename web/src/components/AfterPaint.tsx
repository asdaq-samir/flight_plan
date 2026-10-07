import { Suspense, useDeferredValue, type ReactNode } from "react";

/**
 * A chart, or anything as slow to draw, after the frame that shows the
 * rest: its first draw is `fallback`, holding its place, and React draws
 * it in the background straight after (useDeferredValue's first value).
 * In the same task as the tab that showed it, the Performance tab's
 * envelope chart held the tab back 0.7 s on a phone (measured at a
 * quarter of a laptop's speed, 2026-10-07). Its own Suspense too, with
 * the same fallback, for a chart's code still coming.
 */
export default function AfterPaint({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const drawn = useDeferredValue(true, false);
  return <Suspense fallback={fallback}>{drawn ? children : fallback}</Suspense>;
}
