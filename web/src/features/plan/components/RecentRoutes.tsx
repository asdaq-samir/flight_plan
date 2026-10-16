import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "cn";
import { ListPageHead, PillSection } from "../../../components/Favorites";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ClearList, SwipeToDelete } from "../../../components/SwipeToDelete";
import { pointName } from "../../../lib/identSchema";
import { RECENTS_SHOWN, recentRouteKey, usePreferences, type RecentRoute } from "../../../lib/preferences";
import { TEXT } from "../../../lib/text";

/** The plan's address for a route planned again: its ends and its stops. */
function hrefOf(route: RecentRoute): string {
  return `/plan?${new URLSearchParams({ dep: route.dep, dest: route.dest, ...(route.stops.length ? { stops: route.stops.join(",") } : {}) })}`;
}

/**
 * FPL's Recents under its Saved, at the owner's ask ("Can we have recents
 * under saved ?"): the latest routes planned, newest first, kept on this
 * device -- the airports' and the airplanes' Recents for routes -- a tap
 * planning one again; See All the rest and Clear (RecentRoutesPage).
 * Nothing while there are none.
 */
export function RecentRoutes({ onSeeAll }: { onSeeAll: () => void }) {
  const routes = usePreferences(s => s.recentRoutes);
  if (!routes.length) return null;
  return (
    <PillSection title="Recents" testId="route-recents" onSeeAll={onSeeAll}>
      <RecentRouteRows routes={routes.slice(0, RECENTS_SHOWN)} />
    </PillSection>
  );
}

/** FPL's Recents in full, from their See All: every one, and Clear for all
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
