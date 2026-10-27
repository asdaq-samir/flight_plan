import { useId, useState } from "react";
import SheetDialog from "../../../components/SheetDialog";
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
 * a field in it from `md` up, and on a phone a sheet with Cancel and Set
 * in its title row (SheetDialog). A waypoint's is a cruising altitude,
 * typed as a flight level over its dashes (FL045), as the altitude's chip
 * writes it; it is flown to the waypoint, the rest of the route as
 * planned. An airport's is what a flight landing there comes down to, in
 * feet above sea level -- its traffic pattern's unless the pilot sets one
 * -- its own elevation the altitude it has with none, at the owner's ask
 * ("airports default to field elevation but changeable"). Set, or given
 * back to the plan.
 */
export default function PointAltitudeDialog({ point, onClose, onSet }: {
  point: EditedPoint | null;
  onClose: () => void;
  onSet: (ident: string, feet: number | null) => void;
}) {
  // Kept as it closes, so its words stay as it slides away; and its own
  // figure for each point opened: what was typed for the last is not
  // this one's.
  const [shown, setShown] = useState(point);
  const [typed, setTyped] = useState(() => figure(point));
  if (point && point !== shown) {
    setShown(point);
    setTyped(figure(point));
  }
  const form = useId();
  const { ident, waypoint, altitude, elevationFt } = shown ?? { ident: "", waypoint: false, altitude: { feet: null, own: false } as PointAltitude };
  // A waypoint's in hundreds of feet, three figures; an airport's in feet.
  const feet = typed ? Number(typed) * (waypoint ? 100 : 1) : NaN;
  const valid = feet > 0 && feet < 18_000;
  return (
    <SheetDialog
      open={!!point} onOpenChange={open => { if (!open) onClose(); }} alert cancel size="sm"
      title={`Altitude at ${ident}`}
      description={waypoint
        ? "Flown to it at this altitude; the rest of the route as planned."
        : `${elevationFt != null ? `Field elevation ${altFt(elevationFt)} ft. ` : ""}Where a flight landing here comes down to, in feet above sea level.`}
      action={{ label: "Set", form, disabled: !valid, testId: "point-altitude-set" }}
      more={altitude.own && (
        <Button type="button" variant="ghost" onClick={() => onSet(ident, null)} data-testid="point-altitude-reset">
          Reset
        </Button>
      )}
      // The field focused, for the figure to be typed at once: an alert
      // focuses its Cancel.
      onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}
    >
      <form id={form} onSubmit={e => { e.preventDefault(); if (valid) onSet(ident, feet); }} className="contents">
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
      </form>
    </SheetDialog>
  );
}

/** The figure a point's altitude is typed as: a waypoint's flight level's
 *  three figures, an airport's feet. */
function figure(point: EditedPoint | null): string {
  const feet = point?.altitude.feet ?? null;
  if (feet === null) return "";
  return point!.waypoint ? flightLevel(feet).slice(3) : String(Math.round(feet));
}
