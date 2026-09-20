import { FlaskConical } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "cn";
import IconButton from "./IconButton";

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
 * Dev mode, off or on: the flask at the leading edge of both headers,
 * empty on Plan and full on Dev. One control instead of a Dev link on
 * one page and a Plan link on the other, so switching roles is one
 * switch in one place, and it reads as what it is -- the same page
 * with the developer's drawers in place of the pilot's -- rather than
 * a link away. A `switch` role with `aria-checked`, since that is the
 * meaning; flipping it navigates. The route on screen comes along both
 * ways, and where Plan was (the open briefing, say) is remembered on
 * the way to Dev and restored on the way back -- plain location state,
 * not lifted into every caller's own props: this is the one place that
 * already knows the current route without being told.
 */
export default function DevSwitch() {
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
  return (
    <IconButton role="switch" aria-checked={on} label="Dev mode" onClick={flip} data-testid="dev-switch">
      {/* Full when on: lucide's icons are strokes, and filling the
          flask's own closed body path with the current colour is what
          "full" is. */}
      <FlaskConical className={cn("size-5", on && "fill-current")} />
    </IconButton>
  );
}
