import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "cn";
import { ListPageHead, PillStrip, SmallMark, SmallTile, StripNote } from "../../../components/Favorites";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ClearList, SwipeToDelete } from "../../../components/SwipeToDelete";
import { pointName } from "../../../lib/identSchema";
import { recentRouteKey, usePreferences, type RecentRoute } from "../../../lib/preferences";
import { TEXT } from "../../../lib/text";

/** The plan's address for a route planned again: its ends, its stops and
 *  what was picked for it (its runways, procedures, holds, altitudes…). */
function hrefOf(route: RecentRoute): string {
  const params = new URLSearchParams({ dep: route.dep, dest: route.dest, ...(route.stops.length ? { stops: route.stops.join(",") } : {}) });
  for (const [key, value] of new URLSearchParams(route.picks ?? "")) if (!params.has(key)) params.set(key, value);
  return `/plan?${params}`;
}

/** The most the strip shows, as Saved's does. */
const STRIP_MOST = 10;

/**
 * FPL's Recents, at the owner's ask ("Can we have recents under saved ?"),
 * one of the lists its strip shows (FplStrip): the latest routes planned,
 * newest first, kept on this device -- the airports' and the airplanes'
 * Recents for routes -- a tap planning one again; the title the rest and
 * Clear (RecentRoutesPage). Tiles, as Saved's are, at the owner's ask
 * ("Recents should also have symbols instead of a list"): the route and
 * the day under a round mark.
 */
export function RecentRouteTiles() {
  const routes = usePreferences(s => s.recentRoutes);
  const navigate = useNavigate();
  if (!routes.length) return <StripNote>None yet: the routes planned are kept here.</StripNote>;
  return (
    <PillStrip testId="route-recents-strip">
      {routes.slice(0, STRIP_MOST).map(route => {
        const dep = pointName(route.dep), dest = pointName(route.dest);
        const day = new Date(route.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <SmallTile
            key={recentRouteKey(route)} onClick={() => navigate(hrefOf(route))} testId="route-recent" title={`${dep}→${dest}`} detail={day} wide
            label={`${dep} to ${dest}${route.stops.length ? ` by ${route.stops.map(pointName).join(", ")}` : ""}, planned ${day}`}
            mark={<SmallMark icon={<History />} className="bg-foreground/8 text-tint" />}
          />
        );
      })}
    </PillStrip>
  );
}

/** FPL's Recents in full, from their title: every one, and Clear for all
 *  of them, asked first. */
export function RecentRoutesPage({ onBack }: { onBack: () => void }) {
  const routes = usePreferences(s => s.recentRoutes);
  const clear = usePreferences(s => s.clearRecentRoutes);
  return (
    <>
      <ListPageHead
        title="Recents" backLabel="Back to Saved" onBack={onBack} testId="route-recents-page"
        action={routes.length > 0 && <ClearList title="Clear the Recents?" description="The routes planned last are forgotten in this browser. Saved flights stay." onClear={clear} testId="route-recents-clear" />}
      />
      {routes.length > 0
        ? <RecentRouteRows routes={routes} onPick={onBack} />
        : <p className={cn("px-1 text-muted-foreground", TEXT.note)}>None yet: the routes planned are kept here.</p>}
    </>
  );
}

/** Each route as the airports' Recents are, taken off by a swipe to the
 *  left: its ends, its stops and the day it was planned. */
function RecentRouteRows({ routes, onPick }: { routes: RecentRoute[]; onPick?: () => void }) {
  const navigate = useNavigate();
  const remove = usePreferences(s => s.removeRecentRoute);
  return (
    <ListGroup>
      {routes.map(route => {
        const key = recentRouteKey(route);
        // A route from a position by its coordinates as a GPS writes them
        // (pointName), as Saved's tiles name it.
        const dep = pointName(route.dep), dest = pointName(route.dest);
        const day = new Date(route.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <SwipeToDelete key={key} label={`Remove ${dep} to ${dest} from Recents`} onDelete={() => remove(key)}>
            <ListRow
              media={<History className="size-5 text-muted-foreground" />}
              title={<span className="font-mono font-semibold">{dep} → {dest}</span>}
              description={[route.stops.length ? `By ${route.stops.map(pointName).join(", ")}` : null, day].filter(Boolean).join(" · ")}
              onClick={() => { onPick?.(); navigate(hrefOf(route)); }} data-testid="route-recent"
            />
          </SwipeToDelete>
        );
      })}
    </ListGroup>
  );
}
