import { Check } from "lucide-react";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import type { RouteOption, RouteOptions } from "../../../lib/api/types";
import { isRoute, wayTime, wayTitle } from "../../../lib/routeWays";
import { grouped } from "../../../lib/units";

/** A hazard's words inside a line: "Thunderstorms forecast" as
 *  "thunderstorms forecast", an ident (KDLH, P-56) as it is. */
function inLine(words: string[]): string {
  return words.join("; ").replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
}

/**
 * FPL's Routes (vfr.route_options), at the owner's ask ("smart to reroute
 * for fastest time along safe weather, over terrain, best tailwinds,
 * refueling and giving pilot flexibility to make changes as they please",
 * 2026-10-23), offered as Maps offers its routes, two or three to pick
 * from: the fastest, the one in the best weather and the one with the
 * fewest stops, each with its time, its fuel stops and its miles, and what
 * it goes round. A tap puts that way in the route, its fuel stops named as
 * such; the route stays the pilot's to change, and what it meets once
 * changed -- a thunderstorm, weather under the minimums -- is said on its
 * own row ("Keep yours, flag issues"). Nothing at all where the route is
 * already the best of every kind and meets nothing.
 */
export default function RouteChoices({ found, stops, onPick, onDirect }: {
  found: RouteOptions | undefined;
  /** The route's points between its ends, as the address has them. */
  stops: string[];
  onPick: (option: RouteOption) => void;
  /** The straight line put back, its stops taken out. */
  onDirect: () => void;
}) {
  if (!found) return null;
  const name = (i: number) => found.hazards[i]?.name ?? "";
  // What the route as it is meets: its own line, or the straight one.
  const meets = stops.length ? found.current : found.direct;
  const others = found.options.filter(o => !isRoute(o, stops));
  if (!meets.length && !others.length) return null;
  const ends = found.ends.map(name);
  return (
    <ListGroup
      title="Routes" className="pb-4"
      footer={[...ends, ...found.unchecked.map(what => `Not checked: ${what}`)].join(" · ") || undefined}
    >
      {meets.length > 0 && (
        <ListRow
          title="Your Route" data-testid="route-choice-current"
          description={<span className="text-destructive-ink">Crosses {inLine(meets.map(name))}</span>}
        />
      )}
      {/* The straight line, one tap away from a route of the pilot's own,
          with what it crosses: a warning, never a refusal (the owner's "a
          warning tick or a label is enough"). */}
      {stops.length > 0 && !found.options.some(o => o.stops.length === 0) && (
        <ListRow
          title="Direct" data-testid="route-choice-direct" onClick={onDirect}
          description={found.direct.length
            ? <span className="text-destructive-ink">Crosses {inLine(found.direct.map(name))}</span>
            : "The straight line, clear"}
        />
      )}
      {found.options.map(option => {
        const used = isRoute(option, stops);
        const round = meets.filter(h => !option.crosses.includes(h)).map(name);
        const stopsWords = option.landings ? `${option.landings} fuel stop${option.landings > 1 ? "s" : ""}` : "No stops";
        return (
          <ListRow
            key={option.kinds.join("-")} data-testid={`route-choice-${option.kind}`}
            title={wayTitle(option)}
            description={(
              <>
                <span className="block tabular-nums">{wayTime(option)} · {stopsWords} · {grouped(Math.round(option.distance_nm))} nm</span>
                {round.length > 0 && <span className="block">Round {inLine(round)}</span>}
                {/* Where no way keeps clear: the one crossing least, with
                    what it crosses, a warning (the owner's "a warning tick
                    or a label is enough"). */}
                {option.crosses.length > 0 && <span className="block text-destructive-ink">Crosses {inLine(option.crosses.map(name))}</span>}
                {option.marginal.length > 0 && <span className="block text-caution-ink">Passes {inLine(option.marginal.map(name))}</span>}
              </>
            )}
            {...(used
              ? { media: <Check className="size-4 text-tint" aria-label="In use" /> }
              : { onClick: () => onPick(option) })}
          />
        );
      })}
    </ListGroup>
  );
}
