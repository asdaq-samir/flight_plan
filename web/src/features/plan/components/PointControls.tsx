import type { ReactNode } from "react";
import { MoveUpRight } from "lucide-react";
import { cn } from "cn";
import RoundButton from "../../../components/RoundButton";
import { TEXT } from "../../../lib/text";

/**
 * A point's altitude at the end of its row: the pilot's own, filled in the
 * tint, else what the point has without one -- the chart's crossing, the
 * plan's cruise to it, a field's elevation -- on grey. A tap opens where it
 * is set. One look for a procedure's fix (FixBranch) and the route's own
 * points (ProceduresRoute), at the owner's ask ("All the other fixes and
 * stops can have a direct to and altitude").
 */
export function AltitudeChip({ own, children, label, onClick, testId }: {
  /** The pilot's own altitude set here. */
  own: boolean;
  /** What it says: the altitude, or "Alt" with none known. */
  children: ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} aria-label={label}
      className={cn(
        "relative h-8 min-w-16 shrink-0 rounded-lg px-2 tabular-nums after:absolute after:-inset-y-1.5 after:content-['']", TEXT.detail,
        own ? "bg-primary font-semibold text-primary-foreground" : "bg-foreground/6 text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Direct to a point, as ATC sends an airplane: pressed while it is the
 *  one flown direct to, a tap then flying the route as it was. */
export function DirectButton({ ident, direct, undo, onClick, testId, className }: {
  ident: string;
  direct: boolean;
  /** What a tap does while pressed ("Fly ILS 22 as charted"). */
  undo: string;
  onClick: () => void;
  testId: string;
  className?: string;
}) {
  return (
    <RoundButton
      label={direct ? `${undo}, not direct to ${ident}` : `Direct to ${ident}`}
      onClick={onClick} aria-pressed={direct} data-testid={testId}
      className={cn(className, direct ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-tint")}
    >
      <MoveUpRight className="size-5" />
    </RoundButton>
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
