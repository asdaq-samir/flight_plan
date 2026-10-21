import { useMemo } from "react";
import { sameField } from "../../../lib/procedures";
import { useSearchParamsNow } from "../../../lib/useSearchParamsNow";

/**
 * The stops the pilot put in from the planner's fuel stops (FPL's Add fuel
 * stop, the address's `fuel`), the only ones named "Fuel stop" where the
 * route is read, at the owner's notice ("kenw was not a fuel stop, it was
 * my own stop"): a stop of the pilot's own is a stop. A test of one, by
 * the field, not its spelling (UES is KUES).
 */
export function useFuelStops(): (ident: string) => boolean {
  const [params] = useSearchParamsNow();
  const raw = params.get("fuel") ?? "", stops = params.get("stops") ?? "";
  return useMemo(() => {
    // Still a stop: one taken out and typed in again by hand is the pilot's.
    const fuel = raw.split(",").filter(f => f && stops.split(",").some(s => sameField(s, f)));
    return (ident: string) => fuel.some(f => sameField(f, ident));
  }, [raw, stops]);
}
