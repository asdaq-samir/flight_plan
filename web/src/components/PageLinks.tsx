import { Link, useLocation } from "react-router-dom";
import { FlaskConical, Map as MapIcon } from "lucide-react";
import IconButton from "./IconButton";

/**
 * The two pages link to each other from the same corner of the header:
 * Plan (the pilot's) carries a flask to Dev, Dev (the developer's) a
 * map back to Plan. The Dev link remembers where it was clicked from
 * (`state.from` -- the Brief tab, say), so the map link returns there
 * exactly rather than to Plan's default view. Plain location state,
 * not lifted into every caller's own props: this is the one place that
 * already knows the current route without being told.
 */
export function DevLink() {
  const { pathname, search } = useLocation();
  return (
    <IconButton asChild label="Dev">
      <Link to="/dev" state={{ from: pathname + search }}>
        <FlaskConical className="size-5" />
      </Link>
    </IconButton>
  );
}

export function PlanLink() {
  const location = useLocation();
  // No state at all (Dev opened directly, a bookmark or a fresh tab)
  // falls back to the map.
  const href = (location.state as { from?: string } | null)?.from ?? "/plan";
  return (
    <IconButton asChild label="Plan">
      <Link to={href}>
        <MapIcon className="size-5" />
      </Link>
    </IconButton>
  );
}
