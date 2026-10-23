import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, CarFront, Fuel, Loader2, Utensils } from "lucide-react";
import { cn } from "cn";
import { CardHead } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import Segmented from "../../../components/Segmented";
import { faaWords } from "../../../lib/advisories";
import type { RouteStopField, Totals } from "../../../lib/api/types";
import { routeStopsQuery } from "../../../lib/queryClient";
import { stopFigures, stopsOfKind, useStopsAlong, type StopsKind } from "../../../lib/stopsAlong";
import { awayWords, fuelNames } from "../../../lib/stopServices";
import { TEXT } from "../../../lib/text";
import { hhmm } from "../format";

const KINDS: { value: StopsKind; label: string; icon: ReactNode }[] = [
  { value: "fuel", label: "Fuel", icon: <Fuel /> },
  { value: "food", label: "Food", icon: <Utensils /> },
  { value: "rest", label: "Rest", icon: <BedDouble /> },
];

/** What a field has of the kind picked, in a few words. */
function whatsThere(field: RouteStopField, kind: StopsKind): string {
  if (kind === "fuel") return fuelNames(field.fuel_types ?? []);
  if (kind === "food") return field.food ? `${field.food.name} · ${awayWords(field.food)}` : "";
  const parts = [
    field.lodging && `${field.lodging.name} · ${awayWords(field.lodging)}`,
    field.courtesy_car ? "Courtesy car" : field.car && `${field.car.name} · ${awayWords(field.car)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

const KIND_ICON: Record<StopsKind, ReactNode> = {
  fuel: <Fuel className="size-3.5 shrink-0" aria-hidden />,
  food: <Utensils className="size-3.5 shrink-0" aria-hidden />,
  rest: <BedDouble className="size-3.5 shrink-0" aria-hidden />,
};

/**
 * The fields along the route to stop at, a card over FPL as the Brief and
 * the Profile are, opened from the map's Stops button, at the owner's pick
 * (option C of the stops canvas, "Try C", 2026-10-23: "a button to show
 * food, fuel, rest options along the route they can pick from"). Fuel,
 * Food or Rest picks which; each field in route order with how long to it
 * from its flight's departure, the fuel the airplane lands with (in red
 * under the reserve) and the miles it adds, what it has of the kind picked,
 * and Add, which puts it in the route at its place -- a fuel stop from
 * Fuel, the pilot's own stop from Food and Rest. Its name opens its card.
 * The chart pins the same fields (RouteMap's stop pins).
 */
export default function StopsCard({ name, line, dep, dest, stops, totals, onClose, onOpenField, onAdd }: {
  name: ReactNode;
  line: ReactNode;
  dep: string;
  dest: string;
  stops: string;
  totals: Totals | null;
  onClose: () => void;
  onOpenField: (ident: string) => void;
  /** Put in the route after its flight's departure, as a fuel stop or not. */
  onAdd: (departure: string, ident: string, fuel: boolean) => void;
}) {
  const kind = useStopsAlong(s => s.kind);
  const setKind = useStopsAlong(s => s.setKind);
  const { data, isLoading, isError } = useQuery(routeStopsQuery(dep, dest, stops));
  const fields = data ? stopsOfKind(data.fields, kind) : [];
  const pending = kind === "fuel" ? 0 : data?.pending ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="stops-card">
      <CardHead name={name} line={line} nameTestId="stops-name" onClose={onClose} closeTestId="stops-close" />
      <Segmented
        label="Show" value={kind} onChange={v => setKind(v as StopsKind)} options={KINDS} testId="stops-kind"
        className="mt-3 w-full [&>*]:flex-1"
      />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-3">
        {isLoading && <p className={cn("text-muted-foreground", TEXT.prose)}>Looking along the route…</p>}
        {isError && <p className={cn("text-muted-foreground", TEXT.prose)}>The fields along the route could not be looked up</p>}
        {data && (
          <ListGroup>
            {fields.map(field => {
              const at = stopFigures(field, totals);
              const there = whatsThere(field, kind);
              return (
                <ListRow
                  key={field.ident} data-testid="stops-field"
                  title={(
                    <button
                      type="button" onClick={() => onOpenField(field.ident)} data-testid="stops-field-open"
                      className="text-left font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {field.ident} · {faaWords(field.city || field.name)}
                    </button>
                  )}
                  description={(
                    <span className="flex flex-col gap-0.5">
                      <span className="tabular-nums">
                        {at.minutes != null && `${hhmm(at.minutes)} from ${field.departure} · `}
                        {at.landsWithGal != null && (
                          <span className={cn(at.underReserve && "font-semibold text-destructive-ink")}>
                            {at.underReserve ? "Under the reserve" : `lands ${Math.floor(at.landsWithGal)} gal`} ·{" "}
                          </span>
                        )}
                        +{Math.round(field.added_nm)} nm
                      </span>
                      {there && (
                        <span className="flex min-w-0 items-center gap-1 text-foreground">
                          {kind === "rest" && !field.lodging ? <CarFront className="size-3.5 shrink-0" aria-hidden /> : KIND_ICON[kind]}
                          <span className="truncate">{there}</span>
                        </span>
                      )}
                    </span>
                  )}
                  value={(
                    <button
                      type="button" onClick={() => onAdd(field.departure, field.ident, kind === "fuel")} data-testid="stops-add"
                      aria-label={`Add ${field.ident} to the route`}
                      className={cn("relative h-8 rounded-full bg-tint/12 px-3.5 font-semibold text-tint outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail)}
                    >
                      Add
                    </button>
                  )}
                />
              );
            })}
            {fields.length === 0 && pending === 0 && (
              <ListRow title={<span className="text-muted-foreground">
                {kind === "fuel" ? "No field along the route sells 100LL" : kind === "food" ? "No field along the route has food listed near it" : "No field along the route has a bed or a car listed near it"}
              </span>} />
            )}
            {pending > 0 && (
              <ListRow
                media={<Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                title={<span className="text-muted-foreground">Looking at {pending} more {pending === 1 ? "field" : "fields"}…</span>}
                data-testid="stops-pending"
              />
            )}
          </ListGroup>
        )}
        {data && kind !== "fuel" && fields.length > 0 && (
          <p className={cn("px-1 pt-1.5 text-muted-foreground", TEXT.note)}>Places © Overture Maps Foundation</p>
        )}
      </div>
    </div>
  );
}
