import { useCallback, useState } from "react";
import { api } from "../../../lib/api/client";
import { positionNow } from "../../../lib/map/ownShip";
import { usePreferences } from "../../../lib/preferences";
import { FIRST_FLIGHT, unseen, useTips } from "../../../lib/tips";
import type { RouteParts } from "../components/RouteBox";

/**
 * The first flight's card (FirstFlight): offered the first time the app
 * opens with no route on this device, and gone for good once it has
 * planned one or been closed -- kept as the tips are (lib/tips), one key
 * among them, so Settings' Tips brings it back with the rest.
 *
 * Plan it plans to the destination from where the pilot is -- own ship's
 * fix, the nearest field to it (the planner's nearest) -- else from the
 * last departure this device planned from, or its Home; with neither, it
 * asks for one (`needsFrom`). Then the route is set as the box sets it
 * (useRouteEdits' setRoute) and the nav log opened over it (`onPlanned`).
 */
export function useFirstFlight({ routed, onPlan, onPlanned }: {
  /** Whether there is a route: the card is for a planner with none. */
  routed: boolean;
  onPlan: (parts: RouteParts) => void;
  onPlanned: () => void;
}) {
  const seen = useTips(s => s.seen);
  const see = useTips(s => s.see);
  const lastDeparture = usePreferences(s => s.recentRoutes[0]?.dep ?? s.homeAirport?.ident ?? null);
  const [needsFrom, setNeedsFrom] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = !routed && unseen(seen, FIRST_FLIGHT);

  const dismiss = useCallback(() => see(FIRST_FLIGHT), [see]);

  const planIt = useCallback(async (dest: string, from: string | null) => {
    setProblem(null);
    setPlanning(true);
    try {
      let dep = from;
      if (!dep) {
        const fix = await positionNow(4000);
        if (fix) dep = (await api.nearestAirports(fix.lat, fix.lon))[0]?.ident ?? null;
      }
      if (!dep) dep = lastDeparture;
      if (!dep) {
        // No position and nothing planned before: the card asks where from.
        setNeedsFrom(true);
        return;
      }
      if (dep === dest) {
        setProblem(`${dest} is where you are. Pick somewhere to fly to.`);
        return;
      }
      onPlan({ dep, stops: [], dest });
      see(FIRST_FLIGHT);
      onPlanned();
    } catch {
      setProblem("The planner could not be reached; check the connection.");
    } finally {
      setPlanning(false);
    }
  }, [lastDeparture, onPlan, onPlanned, see]);

  return { shown, needsFrom, planning, problem, planIt, dismiss };
}
