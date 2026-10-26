import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Utensils } from "lucide-react";
import { cn } from "cn";
import { CardHead } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import QueryState from "../../../components/QueryState";
import { ADD_CAPSULE } from "../../../components/mapChrome";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { placeWords } from "../../../lib/advisories";
import type { FieldFood } from "../../../lib/api/types";
import { usePreferences } from "../../../lib/preferences";
import { airportsFoodQuery, routeFoodQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";

/** The radii offered, nm: a menu of them, not a slider (the owner's
 *  discrete settings), a hundred the default (the owner, 2026-10-26). */
const RADII = [25, 50, 100, 150, 200];

/** How far off the course a field is: "on course", "3 nm off course"
 *  (the owner's "say how far off course instead of the departure",
 *  2026-10-26). */
function offWords(offNm: number | null | undefined): string {
  const nm = Math.round(offNm ?? 0);
  return nm < 1 ? "On course" : `${nm} nm off course`;
}

/** The compass point a field is toward, from its true bearing: "NE". */
function towards(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

/** A filter pill as iOS sets one: filled in the tint when on. */
const pill = (on: boolean) => cn(
  "relative inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full px-3.5 font-semibold whitespace-nowrap outline-none",
  "after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail,
  on ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-foreground",
);

/**
 * The map's fly-in food, its fork-and-knife button's card over FPL, at the
 * owner's pick of the redesign canvas (B, "restaurant first",
 * 2026-10-26): two pills -- Along Route, where there is a route, and
 * Within a radius round the pilot, a second tap on it its menu of radii --
 * then a row for each restaurant on the field (the planner's
 * /api/airports/food and /api/route-food, Overture's places inside the
 * airport's outline): the restaurant's name, its airport and town (a tap
 * the field's card), what it is and how far off course or which way, and
 * its button, Add Stop along the route, Direct To round the pilot.
 */
export default function FoodCard({ name, at, route, scope, onScope, onClose, onOpenField, onAddStop, onDirect }: {
  name: ReactNode;
  /** Own ship, for Within; null where it is not known. */
  at: { lat: number; lon: number } | null;
  /** The course drawn, for Along Route: its ends and stops. */
  route: { dep: string; dest: string; stops: string } | null;
  scope: "route" | "near";
  onScope: (scope: "route" | "near") => void;
  onClose: () => void;
  onOpenField: (ident: string) => void;
  /** Along a route: the field put in it as a stop, where it falls. */
  onAddStop: (field: FieldFood) => void;
  /** Round the pilot: a flight from here straight to the field. */
  onDirect: (ident: string) => void;
}) {
  const radius = usePreferences(p => p.foodRadiusNm);
  const setRadius = usePreferences(p => p.setFoodRadiusNm);
  const along = scope === "route" && !!route;
  const near = useQuery({ ...airportsFoodQuery(at?.lat ?? 0, at?.lon ?? 0, radius), enabled: !along && !!at });
  const onRoute = useQuery({ ...routeFoodQuery(route?.dep ?? "", route?.dest ?? "", route?.stops ?? ""), enabled: along });
  const asked = along ? onRoute : near;
  const { data } = asked;
  const pending = data?.pending ?? 0;
  // One row a restaurant, each with its field's figures.
  const rows = (data?.fields ?? []).flatMap(field => field.food.map(place => ({ field, place })));
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="food-card">
      <CardHead name={name} nameTestId="food-name" onClose={onClose} closeTestId="food-close" />
      <div className="mt-2 flex gap-2" role="group" aria-label="Where to look">
        {route && (
          <button type="button" aria-pressed={along} onClick={() => onScope("route")} className={pill(along)} data-testid="food-scope-route">
            Along Route
          </button>
        )}
        {along ? (
          <button type="button" aria-pressed={false} onClick={() => onScope("near")} className={pill(false)} data-testid="food-radius">
            Within {radius} nm
          </button>
        ) : (
          // Picked, a second tap its radii.
          <DropdownMenu>
            <DropdownMenuTrigger aria-pressed className={pill(true)} data-testid="food-radius">
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
        )}
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-3">
        {!along && !at && (
          <ListGroup>
            <ListRow muted title={route ? "Turn on your location to look round you" : "Turn on your location, or enter a route, to find restaurants at the airports"} />
          </ListGroup>
        )}
        {(along || at) && !data && <QueryState query={asked} fetching="Fetching the airports with a restaurant…" failed="The airports with a restaurant could not be fetched." />}
        {data && (
          <ListGroup>
            {rows.map(({ field, place }) => (
              <ListRow
                key={`${field.ident}-${place.name}`} data-testid="food-field"
                media={(
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#fde6d8] text-[#b93d0a]">
                    <Utensils className="size-5" strokeWidth={2.2} />
                  </span>
                )}
                title={<span className="font-semibold">{place.name}</span>}
                description={(
                  <span className="flex flex-col gap-0.5">
                    <button
                      type="button" onClick={() => onOpenField(field.ident)} data-testid="food-field-open"
                      className="w-fit text-left font-semibold text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {field.ident} · {placeWords(field.city || field.name)}
                    </button>
                    <span className="tabular-nums">
                      {place.kind} · {along ? offWords(field.off_nm) : `${Math.round(field.distance_nm)} nm ${towards(field.bearing_deg)}`}
                    </span>
                  </span>
                )}
                // Along a route, Add Stop; round the pilot, Direct To (the
                // owner's "On course, have a button to add stop and when
                // showing them around current position then have the button
                // for direct to", 2026-10-26).
                value={along ? (
                  <button type="button" onClick={() => onAddStop(field)} data-testid="food-add-stop" aria-label={`Add ${field.ident} as a stop`} className={cn(ADD_CAPSULE, "whitespace-nowrap")}>
                    Add Stop
                  </button>
                ) : (
                  <button type="button" onClick={() => onDirect(field.ident)} data-testid="food-direct" aria-label={`Direct to ${field.ident}`} className={cn(ADD_CAPSULE, "whitespace-nowrap")}>
                    Direct To
                  </button>
                )}
              />
            ))}
            {rows.length === 0 && pending === 0 && (
              <ListRow muted title={along ? "No airport along the route has a restaurant on the field" : `No airport within ${radius} nm has a restaurant on the field`} />
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
        {rows.length > 0 && (
          <p className={cn("px-1 pt-1.5 text-muted-foreground", TEXT.note)}>Places © Overture Maps Foundation</p>
        )}
      </div>
    </div>
  );
}
