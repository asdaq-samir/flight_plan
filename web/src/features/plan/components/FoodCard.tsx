import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "cn";
import { CardHead } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import QueryState from "../../../components/QueryState";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { faaWords } from "../../../lib/advisories";
import type { FieldFood } from "../../../lib/api/types";
import { pointName } from "../../../lib/identSchema";
import { usePreferences } from "../../../lib/preferences";
import { airportsFoodQuery, routeFoodQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";

/** The radii offered, nm: a menu of them, not a slider (the owner's
 *  discrete settings), a hundred the default (the owner, 2026-10-26). */
const RADII = [25, 50, 100, 150, 200];

/** The compass point a field is toward, from its true bearing: "NE". */
function towards(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

/**
 * The map's fly-in food, its fork-and-knife button's card over FPL, at the
 * owner's ask ("that button on the map is for at airport restaurant like
 * for a $100 hamburger", 2026-10-25; "food at the airport itself, like
 * Pilot Pete's at Schaumburg"): the public fields with somewhere to eat on
 * the field (the planner's /api/airports/food, Overture's places inside
 * the airport's outline) -- round the pilot within the radius picked in
 * its menu, nearest first with how far and which way; or, while a course
 * is drawn, along it in route order with the miles each adds (the owner's
 * "when a course is drawn then look for fly in food along the route",
 * 2026-10-26). A field's name opens its card. Fields whose places are
 * still being read are said, and the list asked again until they are in.
 */
export default function FoodCard({ name, at, route, onClose, onOpenField }: {
  name: ReactNode;
  /** Where the fields are looked for round with no course: own ship, else
   *  null. */
  at: { lat: number; lon: number } | null;
  /** The course drawn, to look along: its ends and stops. */
  route: { dep: string; dest: string; stops: string } | null;
  onClose: () => void;
  onOpenField: (ident: string) => void;
}) {
  const radius = usePreferences(p => p.foodRadiusNm);
  const setRadius = usePreferences(p => p.setFoodRadiusNm);
  const near = useQuery({ ...airportsFoodQuery(at?.lat ?? 0, at?.lon ?? 0, radius), enabled: !route && !!at });
  const along = useQuery({ ...routeFoodQuery(route?.dep ?? "", route?.dest ?? "", route?.stops ?? ""), enabled: !!route });
  const asked = route ? along : near;
  const { data } = asked;
  const pending = data?.pending ?? 0;
  const line = route ? "At the airports along the route" : (
    // The radius a menu on the line, as a heading's filter is.
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn("relative inline-flex items-center gap-0.5 font-semibold text-tint outline-none after:absolute after:-inset-2 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring")}
        data-testid="food-radius"
      >
        Within {radius} nm<ChevronDown className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={`${radius}`} onValueChange={value => setRadius(Number(value))}>
          {RADII.map(nm => (
            <DropdownMenuRadioItem key={nm} value={`${nm}`} data-testid="food-radius-option">Within {nm} nm</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="food-card">
      <CardHead name={name} line={line} nameTestId="food-name" onClose={onClose} closeTestId="food-close" />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-3">
        {!route && !at && (
          <ListGroup>
            <ListRow muted title="Turn on your location, or enter a route, to find restaurants at the airports" />
          </ListGroup>
        )}
        {(route || at) && !data && <QueryState query={asked} fetching="Fetching the airports with a restaurant…" failed="The airports with a restaurant could not be fetched." />}
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
                      <span key={place.name} className="truncate">{place.name} · {place.kind}</span>
                    ))}
                    {route && field.departure && (
                      <span className="tabular-nums">{Math.round(field.distance_nm)} nm from {pointName(field.departure)}</span>
                    )}
                  </span>
                )}
                value={(
                  <span className={cn("tabular-nums text-muted-foreground", TEXT.detail)}>
                    {route ? `+${Math.round(field.added_nm ?? 0)} nm` : `${Math.round(field.distance_nm)} nm ${towards(field.bearing_deg)}`}
                  </span>
                )}
              />
            ))}
            {data.fields.length === 0 && pending === 0 && (
              <ListRow muted title={route ? "No airport along the route has a restaurant on the field" : `No airport within ${radius} nm has a restaurant on the field`} />
            )}
            {pending > 0 && (
              <ListRow
                media={<Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                muted title={<>Looking at {pending} more {pending === 1 ? "airport" : "airports"}…</>}
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
