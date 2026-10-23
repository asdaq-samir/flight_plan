import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, CarFront, Fuel, Loader2, Utensils } from "lucide-react";
import { cn } from "cn";
import { CardHead } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { faaWords } from "../../../lib/advisories";
import type { Totals } from "../../../lib/api/types";
import { routeStopsQuery } from "../../../lib/queryClient";
import { alongGlance, stopFigures } from "../../../lib/stopsAlong";
import { TEXT } from "../../../lib/text";
import { hhmm } from "../format";

const GLANCE_ICONS: Record<ReturnType<typeof alongGlance>[number]["key"], ReactNode> = {
  fuel: <Fuel />, food: <Utensils />, bed: <BedDouble />, car: <CarFront />,
};

/**
 * The fields along the route to stop at, a card over FPL as the Brief and
 * the Profile are, opened from the map's Stops button, at the owner's
 * pick (option C of the stops canvas, "Try C", 2026-10-23), one list of
 * them, at the owner's ask ("Don't need three tabs. Just one list of
 * airports along the route", where Fuel, Food and Rest were three): each
 * field in route order with how long to it from its flight's departure,
 * the fuel the airplane lands with (in red under the reserve) and the miles
 * it adds, then what it has -- 100LL, the nearest food and bed, a car --
 * and Add, which puts it in the route at its place as the pilot's own
 * stop. Its name opens its card, whose Info lists the fuel, food, beds and
 * cars in full (StopServices). The chart pins the same fields.
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
  /** Put in the route after its flight's departure. */
  onAdd: (departure: string, ident: string) => void;
}) {
  const { data, isLoading, isError } = useQuery(routeStopsQuery(dep, dest, stops));
  const pending = data?.pending ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="stops-card">
      <CardHead name={name} line={line} nameTestId="stops-name" onClose={onClose} closeTestId="stops-close" />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-3">
        {isLoading && <p className={cn("text-muted-foreground", TEXT.prose)}>Looking along the route…</p>}
        {isError && <p className={cn("text-muted-foreground", TEXT.prose)}>The fields along the route could not be looked up</p>}
        {data && (
          <ListGroup>
            {data.fields.map(field => {
              const at = stopFigures(field, totals);
              const glance = alongGlance(field);
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
                      {glance.length > 0 && (
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-foreground" data-testid="stops-glance">
                          {glance.map(g => (
                            <span key={g.key} className="inline-flex items-center gap-1 whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0">
                              {GLANCE_ICONS[g.key]}{g.words}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  )}
                  value={(
                    <button
                      type="button" onClick={() => onAdd(field.departure, field.ident)} data-testid="stops-add"
                      aria-label={`Add ${field.ident} to the route`}
                      className={cn("relative h-8 rounded-full bg-tint/12 px-3.5 font-semibold text-tint outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail)}
                    >
                      Add
                    </button>
                  )}
                />
              );
            })}
            {data.fields.length === 0 && (
              <ListRow title={<span className="text-muted-foreground">No public field within 30 nm of the route</span>} />
            )}
            {pending > 0 && (
              <ListRow
                media={<Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                title={<span className="text-muted-foreground">Looking at what is near {pending} more {pending === 1 ? "field" : "fields"}…</span>}
                data-testid="stops-pending"
              />
            )}
          </ListGroup>
        )}
        {data && data.fields.some(f => f.food || f.lodging || f.car) && (
          <p className={cn("px-1 pt-1.5 text-muted-foreground", TEXT.note)}>Places © Overture Maps Foundation</p>
        )}
      </div>
    </div>
  );
}
