import { useState } from "react";
import { MoveUpRight } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { altitudeLines, fixRoles, type BranchFix } from "../../../lib/procedures";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";

/** The fix whose card is open: its field, its procedure's name as the
 *  route's box says it, and the fix. */
export interface OpenFix {
  field: string;
  kind: "approach" | "arrival" | "departure";
  procedure: string;
  fix: BranchFix;
  direct: boolean;
  /** The pilot's own altitude to cross it at, feet; null, the chart's. */
  own: number | null;
}

/**
 * A procedure's fix, opened from its branch in FPL's list (FixBranch) or a
 * tap on it on the map (ProcedureLayer), at the owner's pick (the fix
 * canvas's card): Direct to it, as ATC sends an airplane, or flown as
 * charted again; and the altitude to cross it at -- the chart's, and the
 * pilot's own in its place, typed in feet, or As charted. A sheet on a
 * phone with its title on top, Back and Close.
 */
export default function FixCard({ open, onClose, onDirect, onCross }: {
  open: OpenFix | null;
  onClose: () => void;
  onDirect: (open: OpenFix, direct: boolean) => void;
  onCross: (fix: string, feet: number | null) => void;
}) {
  return (
    <ResponsivePopover open={!!open} onOpenChange={next => { if (!next) onClose(); }}>
      {/* Beside the top of the screen on a desktop, whichever opened it. */}
      <ResponsivePopoverAnchor asChild><span aria-hidden="true" className="pointer-events-none fixed top-16 left-1/2 size-0" /></ResponsivePopoverAnchor>
      <ResponsivePopoverContent
        title={open?.fix.ident ?? "Fix"} side="bottom" align="center"
        className="flex w-80 flex-col gap-3 p-3" data-testid="fix-card"
        action={<CloseButton onClick={onClose} data-testid="fix-card-close" />}
        sheetOverlayClassName="bg-transparent dark:bg-transparent supports-backdrop-filter:backdrop-blur-none"
      >
        {open && <FixCardBody key={`${open.field}-${open.kind}-${open.fix.ident}`} open={open} onDirect={onDirect} onCross={onCross} />}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

function FixCardBody({ open, onDirect, onCross }: {
  open: OpenFix;
  onDirect: (open: OpenFix, direct: boolean) => void;
  onCross: (fix: string, feet: number | null) => void;
}) {
  const { fix, own, direct } = open;
  const [typed, setTyped] = useState(own != null ? String(own) : "");
  const feet = typed ? Number(typed) : NaN;
  // A VFR altitude, under Class A's floor (14 CFR 71.33, 91.135), as the
  // planner takes one.
  const valid = Number.isInteger(feet) && feet > 0 && feet < 18_000;
  const charted = altitudeLines(fix).words;
  const roles = fixRoles(fix);
  return (
    <div className="flex flex-col gap-3">
      <p className={cn("text-center text-muted-foreground", TEXT.note)}>
        {[...roles, open.procedure, open.field].join(" · ")}
      </p>
      <Button
        type="button" size="lg" variant={direct ? "secondary" : "default"} onClick={() => onDirect(open, !direct)}
        className={cn("w-full", TEXT.row)} data-testid="fix-card-direct"
      >
        {direct ? `Fly ${open.procedure} as Charted` : <><MoveUpRight className="size-5" aria-hidden /> Direct To {fix.ident}</>}
      </Button>
      <form onSubmit={e => { e.preventDefault(); if (valid) onCross(fix.ident, feet); }}>
        <ListGroup>
          <ListRow title="Charted" value={charted ? charted.charAt(0).toUpperCase() + charted.slice(1) : "None"} />
          <ListRow title={<label htmlFor="fix-cross">Cross at</label>}>
            <span className="flex items-center gap-1.5">
              <Input
                id="fix-cross" value={typed} onChange={e => setTyped(e.target.value.replace(/\D/g, "").slice(0, 5))}
                inputMode="numeric" enterKeyHint="done" autoComplete="off" placeholder={own != null ? altFt(own) : "Feet"}
                className="h-9 w-24 text-right tabular-nums" aria-label={`Altitude to cross ${fix.ident} at, feet`} data-testid="fix-card-altitude"
              />
              <Button type="submit" size="sm" disabled={!valid || feet === own} data-testid="fix-card-set">Set</Button>
            </span>
          </ListRow>
          {own != null && <ListRow title="As charted" onClick={() => onCross(fix.ident, null)} data-testid="fix-card-charted" />}
        </ListGroup>
      </form>
    </div>
  );
}
