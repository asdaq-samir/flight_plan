import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../../../components/ui/input-group";
import { TEXT } from "../../../lib/text";
import { altFt, flightLevel } from "../../../lib/units";

/** The altitude at a point of the route: the pilot's own (`own`), else
 *  the plan's -- a waypoint's cruise there, an airport's pattern -- in
 *  feet; null before the planner has said. */
export interface PointAltitude {
  feet: number | null; own: boolean;
  /** What is wrong with the pilot's own, as the planner checked it against
   *  the band it worked out there (14 CFR 91.119, 91.159, 91.131, 91.155). */
  caution?: string[];
}

/** The point whose altitude is being set, from its menu (RouteBox) or its
 *  row in FPL's list (ProceduresRoute); an airport's elevation where it is
 *  known, the altitude it has without one there. */
export interface EditedPoint { ident: string; waypoint: boolean; altitude: PointAltitude; elevationFt?: number | null }

/**
 * A point's own altitude, asked as iOS asks for one figure: an alert with
 * a field in it. A waypoint's is a cruising altitude, typed as a flight
 * level over its dashes (FL045), as the altitude's chip writes it; it is
 * flown to the waypoint, the rest of the route as planned. An airport's
 * is what a flight landing there comes down to, in feet above sea level --
 * its traffic pattern's unless the pilot sets one -- its own elevation the
 * altitude it has with none, at the owner's ask ("airports default to
 * field elevation but changeable"). Set, or given back to the plan.
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
  const { ident, waypoint, altitude, elevationFt } = point;
  // A waypoint's in hundreds of feet, three figures; an airport's in feet.
  const shown = (feet: number | null) => (feet === null ? "" : waypoint ? flightLevel(feet).slice(2) : String(Math.round(feet)));
  const [typed, setTyped] = useState(shown(altitude.feet));
  const feet = typed ? Number(typed) * (waypoint ? 100 : 1) : NaN;
  const valid = feet > 0 && feet < 18_000;
  return (
    <form onSubmit={e => { e.preventDefault(); if (valid) onSet(ident, feet); }} className="contents">
      <AlertDialogHeader>
        <AlertDialogTitle>Altitude at {ident}</AlertDialogTitle>
        <AlertDialogDescription>
          {waypoint
            ? "Flown to it at this altitude; the rest of the route as planned."
            : `${elevationFt != null ? `Field elevation ${altFt(elevationFt)} ft. ` : ""}Where a flight landing here comes down to, in feet above sea level.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {altitude.caution && altitude.caution.length > 0 && (
        <ul className={`list-disc space-y-0.5 rounded-lg bg-caution-wash py-2 pr-2.5 pl-6 text-caution-ink ${TEXT.prose}`} data-testid="point-altitude-caution">
          {altitude.caution.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {/* The figure with its unit inside the field, the stock input group. */}
      <InputGroup className="h-10 font-mono">
        {waypoint && <InputGroupAddon><InputGroupText>FL</InputGroupText></InputGroupAddon>}
        <InputGroupInput
          value={typed} onChange={e => setTyped(e.target.value.replace(/\D/g, "").slice(0, waypoint ? 3 : 5))}
          placeholder={waypoint ? "---" : "-----"} inputMode="numeric" spellCheck={false}
          aria-label={waypoint ? `Altitude at ${ident}, flight level` : `Altitude at ${ident}, feet`}
          className="font-mono" data-testid="point-altitude-input"
        />
        {!waypoint && <InputGroupAddon align="inline-end"><InputGroupText>ft</InputGroupText></InputGroupAddon>}
      </InputGroup>
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
