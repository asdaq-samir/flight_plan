import { useRef, type ReactNode } from "react";
import { Crosshair, Ellipsis, Info, MoveUpRight, MoveVertical, Repeat2, Trash2 } from "lucide-react";
import { cn } from "cn";
import RoundButton from "../../../components/RoundButton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { TEXT } from "../../../lib/text";

/** What a point's altitude is: a field's elevation, the plan's cruise to
 *  it, the chart's crossing at a procedure's fix, or the pilot's own. */
export type AltitudeKind = "elev" | "cruise" | "pub" | "set";

/**
 * The end of a point's row in FPL's list, at the owner's pick (A of the
 * canvas's rows, 2026-10-20: "keep the format of altitude
 * (elev/published/cruising) and eta to the right side of each
 * depart/arrive and waypoints"): its time over its altitude, the
 * altitude's kind after it, small; the pilot's own in the tint.
 */
export function PointFigures({ time, altitude, kind }: {
  /** Its time, or the picker for it where the airplane leaves. */
  time: ReactNode;
  /** The altitude, or the chart's crossing as it is drawn; none known, none. */
  altitude: ReactNode;
  kind: AltitudeKind;
}) {
  return (
    <span className={cn("flex shrink-0 flex-col items-end tabular-nums leading-tight", TEXT.detail)} data-testid="point-figures">
      {typeof time === "string" ? <span className="font-semibold">{time}</span> : time}
      {altitude != null && (
        <span className={kind === "set" ? "font-semibold text-tint" : "text-muted-foreground"} data-testid="point-altitude-figure" data-kind={kind}>
          {altitude} <span className={TEXT.note}>{kind}</span>
        </span>
      )}
    </span>
  );
}

/**
 * A point's menu, the "⋯" at its row's end, at the owner's ask ("Each stop
 * can have a menu (set altitude, create a fix, hold here, More Info)",
 * "And the menu can include direct to"): shadcn's DropdownMenu, each item
 * there only where the point has it, behind the app's own round button
 * (RoundButton, 36 with a 20-point glyph, as every icon button is).
 */
export function PointMenu({ ident, direct = false, onDirect, onAltitude, onFix, onHold, held = false, onInfo, onRemove, testId = "point-menu" }: {
  ident: string;
  /** Flown direct to now: its item flies the route as planned again. */
  direct?: boolean;
  onDirect?: () => void;
  onAltitude?: () => void;
  /** The pilot's own point off this one (FixFromDialog). */
  onFix?: () => void;
  /** A hold there (HoldSheet); `held`, one is set already. */
  onHold?: () => void;
  held?: boolean;
  onInfo?: () => void;
  onRemove?: () => void;
  testId?: string;
}) {
  // A sheet or a dialog opened from an item once the menu has closed and
  // let the focus go, and the focus not given back to the "⋯": opened
  // while the menu still held the focus, a desktop's popover lost it to
  // the menu and took that for a click outside it, and closed (the hold
  // spec on the desktop project).
  const pending = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <RoundButton label={`${ident}: more`} className="shrink-0 text-tint" data-testid={testId}>
          <Ellipsis className="size-5" aria-hidden="true" />
        </RoundButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end" className="min-w-56"
        onCloseAutoFocus={e => {
          const go = pending.current;
          if (!go) return;
          e.preventDefault();
          pending.current = null;
          window.setTimeout(go);
        }}
      >
        <DropdownMenuLabel>{ident}</DropdownMenuLabel>
        {onDirect && (
          <DropdownMenuItem onSelect={onDirect} data-testid={`${testId}-direct`}>
            <MoveUpRight aria-hidden="true" />{direct ? "Fly as planned" : "Direct to"}
          </DropdownMenuItem>
        )}
        {onAltitude && (
          <DropdownMenuItem onSelect={() => { pending.current = onAltitude; }} data-testid={`${testId}-altitude`}>
            <MoveVertical aria-hidden="true" />Set altitude…
          </DropdownMenuItem>
        )}
        {onFix && (
          <DropdownMenuItem onSelect={() => { pending.current = onFix; }} data-testid={`${testId}-fix`}>
            <Crosshair aria-hidden="true" />Create a fix from here…
          </DropdownMenuItem>
        )}
        {onHold && (
          <DropdownMenuItem onSelect={() => { pending.current = onHold; }} data-testid={`${testId}-hold`}>
            <Repeat2 aria-hidden="true" />{held ? "Change hold…" : "Hold here…"}
          </DropdownMenuItem>
        )}
        {onInfo && (
          <DropdownMenuItem onSelect={() => { pending.current = onInfo; }} data-testid={`${testId}-info`}>
            <Info aria-hidden="true" />More info
          </DropdownMenuItem>
        )}
        {onRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove} data-testid={`${testId}-remove`}>
              <Trash2 aria-hidden="true" />Remove from route
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The route flown direct to a point (PlanWorkspace's directToPoint), said
 *  over the route's figures, as mock 5 of the owner's canvas has it, and
 *  Cancel: the route as it was. */
export function DirectStrip({ ident, onCancel }: { ident: string; onCancel: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-2" data-testid="direct-strip">
      <MoveUpRight className="size-5 shrink-0 text-tint" aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate font-semibold text-tint", TEXT.row)}>Direct to {ident}</span>
      <button
        type="button" onClick={onCancel} data-testid="direct-cancel"
        className={cn("relative shrink-0 px-1 text-tint after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']", TEXT.row)}
      >
        Cancel
      </button>
    </div>
  );
}
