import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { CardHead } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ADD_CAPSULE } from "../../../components/mapChrome";
import QueryState from "../../../components/QueryState";
import { faaWords } from "../../../lib/advisories";
import type { Totals } from "../../../lib/api/types";
import { routeStopsQuery } from "../../../lib/queryClient";
import { stopFigures } from "../../../lib/stopsAlong";
import { TEXT } from "../../../lib/text";
import { hhmm } from "../format";
import { Glance } from "./StopServices";

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
  const asked = useQuery(routeStopsQuery(dep, dest, stops));
  const { data } = asked;
  const pending = data?.pending ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="stops-card">
      <CardHead name={name} line={line} nameTestId="stops-name" onClose={onClose} closeTestId="stops-close" />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-3">
        {/* A line while they are fetched, and Try again where they could not
            be, as every list says it (QueryState). */}
        {!data && <QueryState query={asked} fetching="Fetching the stops along the route…" failed="The fields along the route could not be fetched." />}
        {data && (
          <ListGroup>
            {data.fields.map(field => {
              const at = stopFigures(field, totals);
              return (
                <ListRow
                  key={field.ident} data-testid="stops-field"
                  title={(
                    <button
                      type="button" onClick={() => onOpenField(field.ident)} data-testid="stops-field-open"
                      // In the tint, as a name that opens something is.
                      className="text-left font-semibold text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      <Glance of={field} testId="stops-glance" />
                    </span>
                  )}
                  value={(
                    <button
                      type="button" onClick={() => onAdd(field.departure, field.ident)} data-testid="stops-add"
                      aria-label={`Add ${field.ident} to the route`}
                      className={ADD_CAPSULE}
                    >
                      Add
                    </button>
                  )}
                />
              );
            })}
            {data.fields.length === 0 && (
              <ListRow muted title="No public field within 30 nm of the route" />
            )}
            {pending > 0 && (
              <ListRow
                media={<Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                muted title={<>Fetching what is near {pending} more {pending === 1 ? "field" : "fields"}…</>}
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
