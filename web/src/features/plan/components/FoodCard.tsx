import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { CardHead } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import QueryState from "../../../components/QueryState";
import { faaWords } from "../../../lib/advisories";
import type { FieldFood } from "../../../lib/api/types";
import { airportsFoodQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";

/** "4 min walk", "on the field" for one a minute or two from the ramp. */
function walkWords(minutes: number | null | undefined): string {
  if (minutes == null) return "";
  return minutes <= 2 ? "on the field" : `${minutes} min walk`;
}

/** The compass point a field is toward, from its true bearing: "NE". */
function towards(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

/**
 * The map's fly-in food, its fork-and-pump button's card over FPL, at the
 * owner's ask ("that button on the map is for at airport restaurant like
 * for a $100 hamburger", 2026-10-25): the public fields round the pilot
 * with somewhere to eat a short walk from the ramp (the planner's
 * /api/airports/food, Overture's places), nearest first -- how far and
 * which way, and the places, each with its walk. A field's name opens its
 * card, whose Fly Here makes the trip. Fields whose places are still being
 * read are said, and the list asked again until they are in.
 */
export default function FoodCard({ name, line, at, onClose, onOpenField }: {
  name: ReactNode;
  line: ReactNode;
  /** Where the fields are looked for round: own ship, else the route's
   *  departure; null with neither. */
  at: { lat: number; lon: number } | null;
  onClose: () => void;
  onOpenField: (ident: string) => void;
}) {
  const asked = useQuery({ ...airportsFoodQuery(at?.lat ?? 0, at?.lon ?? 0), enabled: !!at });
  const { data } = asked;
  const pending = data?.pending ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="food-card">
      <CardHead name={name} line={line} nameTestId="food-name" onClose={onClose} closeTestId="food-close" />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-3">
        {!at && (
          <ListGroup>
            <ListRow muted title="Turn on your location, or enter a route, to find food at the fields near you" />
          </ListGroup>
        )}
        {at && !data && <QueryState query={asked} fetching="Fetching the fields with food near you…" failed="The fields with food could not be fetched." />}
        {data && (
          <ListGroup>
            {data.fields.map((field: FieldFood) => (
              <ListRow
                key={field.ident} data-testid="food-field"
                title={(
                  <button
                    type="button" onClick={() => onOpenField(field.ident)} data-testid="food-field-open"
                    className="text-left font-semibold text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {field.ident} · {faaWords(field.city || field.name)}
                  </button>
                )}
                description={(
                  <span className="flex flex-col gap-0.5">
                    {field.food.slice(0, 2).map(place => (
                      <span key={place.name} className="truncate">
                        {place.name} · {walkWords(place.walk_min)}
                      </span>
                    ))}
                  </span>
                )}
                value={(
                  <span className={cn("tabular-nums text-muted-foreground", TEXT.detail)}>
                    {Math.round(field.distance_nm)} nm {towards(field.bearing_deg)}
                  </span>
                )}
              />
            ))}
            {data.fields.length === 0 && pending === 0 && (
              <ListRow muted title="No field near you has food a short walk from the ramp" />
            )}
            {pending > 0 && (
              <ListRow
                media={<Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                muted title={<>Looking at {pending} more {pending === 1 ? "field" : "fields"}…</>}
                data-testid="food-pending"
              />
            )}
          </ListGroup>
        )}
        {data && data.fields.length > 0 && (
          <p className={cn("px-1 pt-1.5 text-muted-foreground", TEXT.note)}>Places © Overture Maps Foundation</p>
        )}
      </div>
    </div>
  );
}
