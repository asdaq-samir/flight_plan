import { MoveUpRight } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../../../lib/text";

/** The route flown direct to a point (PlanWorkspace's directToPoint), said
 *  over the route's figures, as mock 5 of the owner's canvas has it, and
 *  Cancel: the route as it was. The words in the text's colour, Cancel
 *  alone in the tint, as only what is tapped is (the consistency audit,
 *  2026-10-23). */
export default function DirectStrip({ ident, onCancel }: { ident: string; onCancel: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-2" data-testid="direct-strip">
      <MoveUpRight className="size-5 shrink-0 text-foreground" aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate font-semibold text-foreground", TEXT.row)}>Direct to {ident}</span>
      <button
        type="button" onClick={onCancel} data-testid="direct-cancel"
        className={cn("relative shrink-0 px-1 text-tint after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']", TEXT.row)}
      >
        Cancel
      </button>
    </div>
  );
}
