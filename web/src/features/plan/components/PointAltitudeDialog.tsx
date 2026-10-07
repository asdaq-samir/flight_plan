import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { flightLevel } from "../../../lib/units";

/** The altitude at a point of the route: the pilot's own (`own`), else
 *  the plan's -- a waypoint's cruise there, an airport's pattern -- in
 *  feet; null before the planner has said. */
export interface PointAltitude { feet: number | null; own: boolean }

/** The point whose altitude is being set, from its menu (RouteBox). */
export interface EditedPoint { ident: string; waypoint: boolean; altitude: PointAltitude }

/**
 * A point's own altitude, asked as iOS asks for one figure: an alert with
 * a field in it. A waypoint's is a cruising altitude, typed as a flight
 * level over its dashes (FL045), as the altitude's chip writes it; it is
 * flown to the waypoint, the rest of the route as planned. An airport's
 * is its traffic pattern, in feet above sea level, which a flight landing
 * there comes down to. Set, or given back to the plan.
 */
export default function PointAltitudeDialog({ point, onClose, onSet }: {
  point: EditedPoint | null;
  onClose: () => void;
  onSet: (ident: string, feet: number | null) => void;
}) {
  return (
    <AlertDialog open={!!point} onOpenChange={open => { if (!open) onClose(); }}>
      {/* The field focused, for the figure to be typed at once: an alert
          focuses its Cancel. */}
      <AlertDialogContent
        size="sm"
        onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}
      >
        {/* Its own state for each point opened: what was typed for the
            last is not this one's. */}
        {point && <AltitudeForm key={point.ident} point={point} onSet={onSet} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AltitudeForm({ point, onSet }: { point: EditedPoint; onSet: (ident: string, feet: number | null) => void }) {
  const { ident, waypoint, altitude } = point;
  // A waypoint's in hundreds of feet, three figures; an airport's in feet.
  const shown = (feet: number | null) => (feet === null ? "" : waypoint ? flightLevel(feet).slice(2) : String(Math.round(feet)));
  const [typed, setTyped] = useState(shown(altitude.feet));
  const feet = typed ? Number(typed) * (waypoint ? 100 : 1) : NaN;
  const valid = feet > 0 && feet < 18_000;
  return (
    <form onSubmit={e => { e.preventDefault(); if (valid) onSet(ident, feet); }} className="contents">
      <AlertDialogHeader>
        <AlertDialogTitle>{waypoint ? `Altitude at ${ident}` : `Pattern altitude at ${ident}`}</AlertDialogTitle>
        <AlertDialogDescription>
          {waypoint
            ? "Flown to it at this altitude; the rest of the route as planned."
            : "Where a flight landing here comes down to, in feet above sea level."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex h-10 items-center gap-1 rounded-md border border-input bg-background px-3 font-mono">
        {waypoint && "FL"}
        <Input
          value={typed} onChange={e => setTyped(e.target.value.replace(/\D/g, "").slice(0, waypoint ? 3 : 5))}
          placeholder={waypoint ? "---" : "-----"} inputMode="numeric" spellCheck={false}
          aria-label={waypoint ? `Altitude at ${ident}, flight level` : `Pattern altitude at ${ident}, feet`}
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 font-mono shadow-none focus-visible:ring-0 dark:bg-transparent"
          data-testid="point-altitude-input"
        />
        {!waypoint && "ft"}
      </div>
      <AlertDialogFooter>
        {altitude.own && (
          <Button type="button" variant="ghost" onClick={() => onSet(ident, null)} data-testid="point-altitude-reset">
            Reset
          </Button>
        )}
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction type="submit" disabled={!valid} onClick={e => { e.preventDefault(); if (valid) onSet(ident, feet); }} data-testid="point-altitude-set">
          Set
        </AlertDialogAction>
      </AlertDialogFooter>
    </form>
  );
}
