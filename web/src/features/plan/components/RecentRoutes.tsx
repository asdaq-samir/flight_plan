import { useState, type ReactNode } from "react";
import { CircleMinus, History, Share } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "cn";
import { ListPageHead, PillStrip, SmallMark, SmallTile, StripNote } from "../../../components/Favorites";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ClearList, SwipeToDelete } from "../../../components/SwipeToDelete";
import { placeOfPoint } from "../../../lib/identSchema";
import { recentRouteKey, usePreferences, type RecentRoute } from "../../../lib/preferences";
import { TEXT } from "../../../lib/text";
import { whenGroups } from "../../../lib/whenGroups";
import RowMenu from "../../../components/RowMenu";
import { cancelled, shareOrCopy } from "../../../lib/share";
import { showError } from "../../../lib/problems";
import { describeError } from "../../../lib/api/client";

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
        const dep = placeOfPoint(route.dep), dest = placeOfPoint(route.dest);
        const day = new Date(route.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <SmallTile
            key={recentRouteKey(route)} onClick={() => navigate(hrefOf(route))} testId="route-recent" title={`${dep}→${dest}`} detail={day} wide
            label={`${dep} to ${dest}${route.stops.length ? ` by ${route.stops.map(placeOfPoint).join(", ")}` : ""}, planned ${day}`}
            mark={<SmallMark icon={<History />} className="bg-foreground/8 text-tint" />}
          />
        );
      })}
    </PillStrip>
  );
}

/** FPL's Recents in full, from their title: every one, by when, as Maps'
 *  Recents are -- Today, This Week, This Month, Earlier -- each with its
 *  own Clear at its heading's right, asked first (the owner's screenshot
 *  of Maps' Recents, 2026-10-28). */
export function RecentRoutesPage({ onBack }: { onBack: () => void }) {
  const routes = usePreferences(s => s.recentRoutes);
  const remove = usePreferences(s => s.removeRecentRoute);
  // When the page opened, for its headings: not read again at each render.
  const [now] = useState(() => Date.now());
  const groups = whenGroups(routes, now);
  return (
    <>
      <ListPageHead title="Recents" backLabel="Back to Saved" onBack={onBack} testId="route-recents-page" />
      {routes.length > 0 ? (
        <div className="flex flex-col gap-5">
          {groups.map(group => (
            <RecentRouteRows
              key={group.title} title={group.title} routes={group.routes} onPick={onBack}
              action={(
                <ClearList
                  title={`Clear ${group.title === "Earlier" ? "the earlier" : `${group.title.toLowerCase()}'s`} Recents?`}
                  description="Those routes are forgotten in this browser. Saved flights stay."
                  onClear={() => group.routes.forEach(r => remove(recentRouteKey(r)))} testId="route-recents-clear"
                />
              )}
            />
          ))}
        </div>
      ) : <p className={cn("px-1 text-muted-foreground", TEXT.note)}>None yet: the routes planned are kept here.</p>}
    </>
  );
}

/**
 * Each route as a row of Maps' Recents: its round mark, its ends, its
 * stops and the day under them, a tap planning it again; Share and Clear
 * from its ••• or a long press (RowMenu). A swipe to the left still takes
 * it off.
 */
function RecentRouteRows({ title, routes, onPick, action }: { title: string; routes: RecentRoute[]; onPick?: () => void; action?: ReactNode }) {
  const navigate = useNavigate();
  const remove = usePreferences(s => s.removeRecentRoute);
  return (
    <ListGroup title={title} action={action}>
      {routes.map(route => {
        const key = recentRouteKey(route);
        // A route from a position by its coordinates as a GPS writes them
        // (pointName), as Saved's tiles name it.
        const dep = placeOfPoint(route.dep), dest = placeOfPoint(route.dest);
        const day = new Date(route.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const name = `${dep} to ${dest}`;
        const share = () => {
          shareOrCopy({ title: `${dep} → ${dest}`, url: new URL(`/app${hrefOf(route)}`, location.origin).toString() })
            .catch(err => { if (!cancelled(err)) showError("Not shared", describeError(err)); });
        };
        return (
          <SwipeToDelete key={key} label={`Remove ${name} from Recents`} onDelete={() => remove(key)}>
            <RowMenu label={`More for ${name}`} testId="route-recent-more" actions={[
              { label: "Share", icon: <Share />, onSelect: share, testId: "route-recent-share" },
              { label: "Clear", icon: <CircleMinus />, onSelect: () => remove(key), testId: "route-recent-remove" },
            ]}>
              <ListRow
                media={<SmallMark icon={<History />} className="size-9 bg-foreground/70 text-background [&_svg]:size-5" />}
                title={<span className="font-mono font-semibold">{dep} → {dest}</span>}
                description={[route.stops.length ? `By ${route.stops.map(placeOfPoint).join(", ")}` : null, day].filter(Boolean).join(" · ")}
                aria-label={`${name}${route.stops.length ? ` by ${route.stops.map(placeOfPoint).join(", ")}` : ""}, planned ${day}`}
                onClick={() => { onPick?.(); navigate(hrefOf(route)); }} data-testid="route-recent"
              />
            </RowMenu>
          </SwipeToDelete>
        );
      })}
    </ListGroup>
  );
}
