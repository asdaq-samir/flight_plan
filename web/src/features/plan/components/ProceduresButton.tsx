import { useState } from "react";
import { Check, PlaneLanding } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import RoundButton from "../../../components/RoundButton";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { ChartBadge } from "../../../components/RowBadge";
import type { Runway } from "../../../lib/api/types";
import { runwayInUse, runwayNumber } from "../../../lib/pattern";
import { trafficPattern } from "../../../lib/trafficPattern";
import { altFt } from "../../../lib/units";

export interface ProcedureAirport {
  ident: string;
  role: "Departure" | "Stop" | "Destination";
  runways: Runway[] | null;
  patternAltitudeFt: number | null;
}

/**
 * The route's Procedures, at the pilot's ask, where its Approaches were:
 * for each field of the route, the runway whose traffic pattern to draw
 * on the map (PatternLayer) -- each end with the side its traffic is
 * flown on and the pattern's altitude -- and the destination's approach
 * charts, as the button opened before. The FAA's coded approaches,
 * arrivals and departures are to come here too, picked and drawn the same
 * way.
 */
export default function ProceduresButton({ airports, picked, onPick, onCharts, chartsDisabled }: {
  airports: ProcedureAirport[];
  /** The runway end picked for each field's pattern. */
  picked: Map<string, string>;
  onPick: (ident: string, end: string | null) => void;
  /** The destination's approach charts, in its card. */
  onCharts: () => void;
  chartsDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const destination = airports.find(a => a.role === "Destination");
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <RoundButton label="Procedures" disabled={airports.length === 0} data-testid="route-approaches">
          <PlaneLanding className="size-5" strokeWidth={2} />
        </RoundButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Procedures" className="max-h-[70vh] w-80 overflow-y-auto p-3" align="end" side="left">
        <div className="space-y-5" data-testid="procedures">
          {airports.map(a => {
            const ends = (a.runways ?? [])
              .filter(r => !r.closed)
              .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e })))
              .sort((x, y) => x.end.ident.localeCompare(y.end.ident));
            const chosen = picked.get(a.ident) ?? null;
            // The end the reported wind favours (lib/pattern), said, as the
            // one a pilot would land on.
            const windward = a.runways ? runwayInUse(a.runways) : null;
            return (
              <ListGroup
                key={a.ident} title={`${a.ident} · ${a.role} · traffic pattern`}
                footer="Drawn on the map as the FAA's Airplane Flying Handbook flies a pattern: the downwind about three-quarters of a mile out, the base 45° from the runway's end, the 45° entry abeam midfield. A sketch to fly by, not a procedure; the field's own pattern may differ."
              >
                {a.runways === null ? (
                  <ListRow title={<span className="text-muted-foreground">Looking the runways up…</span>} />
                ) : (
                  <>
                    <ListRow
                      role="radio" aria-checked={chosen === null} onClick={() => onPick(a.ident, null)}
                      media={<Check className={cn("size-4 text-tint", chosen !== null && "invisible")} aria-hidden />}
                      title="None"
                    />
                    {ends.map(({ runway, end }) => {
                      const drawn = trafficPattern(a.ident, runway, end.ident, a.patternAltitudeFt) !== null;
                      const id = runwayNumber(end.ident);
                      return (
                        <ListRow
                          key={end.ident} role="radio" aria-checked={chosen === id} disabled={!drawn}
                          onClick={() => onPick(a.ident, id)}
                          media={<Check className={cn("size-4 text-tint", chosen !== id && "invisible")} aria-hidden />}
                          title={`Runway ${id}`}
                          description={drawn
                            ? [
                              windward?.byWind && windward.end.ident === end.ident ? "Into the wind" : null,
                              `${end.traffic === "right" ? "Right" : "Left"} traffic`,
                              a.patternAltitudeFt != null ? `${altFt(a.patternAltitudeFt)} ft` : null,
                            ].filter(Boolean).join(" · ")
                            : "Its end is not surveyed: not drawn"}
                          data-testid="procedure-pattern"
                        />
                      );
                    })}
                  </>
                )}
                {a === destination && (
                  <ListRow
                    media={<ChartBadge />} title="Approach charts" chevron disabled={chartsDisabled}
                    onClick={() => { setOpen(false); onCharts(); }} data-testid="procedure-charts"
                  />
                )}
              </ListGroup>
            );
          })}
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
