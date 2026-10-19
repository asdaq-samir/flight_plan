import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { RunwayPicks } from "./pattern";
import { patternsOf } from "./trafficPattern";

/** The runways the pilot picked in FPL, from the address (`pattern`,
 *  `takeoff`), where FPL keeps them: for the radio calls, the kneeboard,
 *  the mock oral and the runway check, which fly the pick (runwayFlown)
 *  and the wind's runway only where there is none. Read here rather than
 *  handed down, so every part that says a runway reads the same one. */
export function useRunwayPicks(): RunwayPicks {
  const [params] = useSearchParams();
  const pattern = params.get("pattern"), takeoff = params.get("takeoff");
  return useMemo(() => ({ pattern: patternsOf(pattern), takeoff: patternsOf(takeoff) }), [pattern, takeoff]);
}
