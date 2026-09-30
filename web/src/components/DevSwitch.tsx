import { useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { capabilitiesQuery, pilotQuery } from "../lib/queryClient";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

/** The route the two pages share -- dep, dest, altitude -- carried
 *  across; Plan's own `view` is not, Dev has no briefing. */
function routeSearch(search: string): string {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of ["dep", "dest", "altitude_ft"]) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  const s = kept.toString();
  return s ? `?${s}` : "";
}

/**
 * Dev mode, off or on: shadcn's own `Switch`, in the map's settings on
 * both pages (it led the header until the header was slimmed to the
 * route form and its buttons). One control instead of a Dev link on
 * one page and a Plan link on the other, so switching roles is one
 * switch in one place, and it reads as what it is -- the same page
 * with the developer's drawers in place of the pilot's -- rather than
 * a link away. Flipping it navigates. The route on screen comes along
 * both ways, and where Plan was (the open briefing, say) is remembered
 * on the way to Dev and restored on the way back -- plain location
 * state, not lifted into every caller's own props: this is the one
 * place that already knows the current route without being told.
 *
 * Shown only to someone it is for. The training workspace and the
 * developer console are work on the model, not on a flight, so a pilot
 * has no business there and does not see the way in. Two conditions,
 * either of which is enough:
 *
 *   - the signed-in pilot has the developer role (pilots.role, V7)
 *   - the deployment is open to everyone (`access` "OPEN")
 *
 * The second is not a loophole: with no Google or Apple credentials and
 * no mail host there is no way to hold a role, and a deployment that
 * says to open up (app.open-writes) means everyone. One that
 * cannot sign anyone in and did not say so ("CLOSED") refuses every
 * developer path, and used to be offered the switch all the same. A
 * real deployment has sign-in configured, and
 * there the role is the whole answer.
 *
 * Both queries are quiet on failure: the header is not the place to
 * report that a capability probe 500'd, and either failing simply
 * leaves the switch hidden.
 *
 * On the dev page, someone it is not for -- signed out from the
 * developer console, or a session that ended -- is taken to the map
 * rather than left on a workspace whose every call the server refuses.
 */
function useDevMode() {
  const { data: pilot, isSuccess: pilotKnown } = useQuery(pilotQuery);
  const { data: capabilities } = useQuery(capabilitiesQuery);
  const { pathname, search, state } = useLocation();
  const navigate = useNavigate();
  const on = pathname.startsWith("/dev");
  const flip = () => {
    if (on) {
      // No state at all (Dev opened directly, a bookmark or a fresh
      // tab) falls back to the map, with Dev's own route.
      const from = (state as { from?: string } | null)?.from;
      void navigate(from ?? `/plan${routeSearch(search)}`);
    } else {
      void navigate(`/dev${routeSearch(search)}`, { state: { from: pathname + search } });
    }
  };
  // Undefined while either query is in flight: the switch appears when
  // the answer does, rather than flashing in and out.
  const allowed = pilot?.developer === true || capabilities?.access === "OPEN";
  const refused = on && pilotKnown && capabilities !== undefined && !allowed;
  return { on, flip, allowed, refused, navigate, search };
}

/** The refusal half, mounted with the page rather than with the
 *  settings (which are only in the page while they are open). */
export function DevGuard() {
  const { refused, navigate, search } = useDevMode();
  useEffect(() => {
    if (refused) void navigate(`/plan${routeSearch(search)}`, { replace: true });
  }, [refused, navigate, search]);
  return null;
}

export default function DevSwitch() {
  const { on, flip, allowed } = useDevMode();
  const id = useId();
  if (!allowed) return null;
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Developer</div>
      <div className="flex items-center gap-2">
        <Switch id={id} checked={on} onCheckedChange={flip} aria-label="Dev mode" data-testid="dev-switch" />
        <Label htmlFor={id} className="font-normal">Dev mode</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        The training workspace and the developer console in place of the planner, on the same route.
      </p>
    </div>
  );
}
