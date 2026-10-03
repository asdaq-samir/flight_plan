import { X } from "lucide-react";
import AirportPicker from "../../../components/AirportPicker";
import IconButton from "../../../components/IconButton";
import { MAX_STOPS } from "../../../lib/identSchema";
import type { Detour } from "../../../lib/api/types";

/**
 * Where a route stops on the way, as Maps' Add Stop: each stop a chip --
 * the picker to change it, a cross to take it out -- in the order they
 * are flown, and Add Stop after them, which puts one on before the
 * destination. An airport is landed at: the flight from one landing to
 * the next has its own climb and its own fuel check, the tanks filled at
 * each. A VFR or GPS waypoint (VPBNG) is flown through, at cruise.
 * A change re-plans at once, as the aeroplane's and the time's do beside
 * it. `adding` opens Add Stop from elsewhere: no legal altitude's own
 * Add a stop, or its Fly via (PlanWorkspace) -- `via`, the waypoints
 * round the Class B that stops a flight, suggested at the picker's top,
 * and the stop put on that flight rather than before the destination.
 */
export default function StopsBar({ stops, onChange, adding, onAddingChange, via }: {
  stops: string[];
  onChange: (stops: string[]) => void;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  via?: Detour[];
}) {
  const at = via?.[0]?.stop_index ?? stops.length;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-3" role="group" aria-label="Stops" data-testid="stops">
      {stops.map((stop, i) => (
        // A stop's place in the order is its key: the same airport twice
        // is two stops, at two places.
        <span key={`${i}-${stop}`} className="inline-flex items-center rounded-full bg-foreground/8 pr-0.5" data-testid="stop">
          <AirportPicker
            value={stop} placeholder="Stop" ariaLabel={`Stop ${i + 1}`} className="h-8 rounded-full pr-1" fixes
            onChange={ident => onChange(stops.map((s, j) => (j === i ? ident : s)))}
          />
          <IconButton
            label={`Remove the stop at ${stop}`} size="icon-sm" className="rounded-full text-muted-foreground"
            onClick={() => onChange(stops.filter((_, j) => j !== i))}
          >
            <X />
          </IconButton>
        </span>
      ))}
      {stops.length < MAX_STOPS && (
        <AirportPicker
          value="" placeholder="Add Stop" ariaLabel="Add a stop" look="add" className="h-8" fixes
          open={adding} onOpenChange={onAddingChange} testId="add-stop"
          onChange={ident => onChange([...stops.slice(0, at), ident, ...stops.slice(at)])}
          suggestions={via?.map(d => ({
            ident: d.ident, kind: d.kind,
            detail: [d.description, `+${Math.round(d.added_nm)} nm, clear of the Class B`].filter(Boolean).join(" · "),
          }))}
        />
      )}
    </div>
  );
}
