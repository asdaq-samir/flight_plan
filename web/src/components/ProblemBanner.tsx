import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "cn";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { GLASS } from "./mapChrome";
import { TEXT } from "../lib/text";
import { useSystemProblems } from "../lib/problems";

/**
 * What the app could not do that is not the pilot's doing -- the planner
 * or a service out, a download that failed (lib/problems) -- as one line
 * on the map, beside its buttons and level with them, in the stock
 * Alert on the map buttons' glass: the problem, or how many there are,
 * and Try again where asking
 * again could help. A tap on the words shows all of it. It goes when
 * what caused it has, and sits in the map's own layer, under the panel:
 * nothing of the panel or its grabber is ever under it. It was a toast
 * per problem, a stack of them folded to lines the panel had to stop
 * short of.
 */
export default function ProblemBanner({ clearLeft = false }: {
  /** Clear of map buttons on the left as well (MapControlsLeft). */
  clearLeft?: boolean;
}) {
  const problems = useSystemProblems(s => s.problems);
  const [open, setOpen] = useState(false);
  if (problems.length === 0) return null;
  const retries = problems.filter(p => p.retry);
  const title = problems.length === 1 ? problems[0]!.title : `${problems.length} problems`;
  return (
    // Beside the map's buttons (MapControls), on their edge: the top
    // right under a panel at the bottom, the bottom right otherwise.
    <div
      className={cn(
        "pointer-events-none absolute right-[calc(max(0.5rem,env(safe-area-inset-right))+3.25rem)] bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[1000] flex nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] nav-bottom:bottom-auto",
        clearLeft ? "left-[calc(max(0.5rem,env(safe-area-inset-left))+3.25rem)]" : "left-[max(1rem,env(safe-area-inset-left))]",
      )}
      data-problem-banner=""
    >
      {/* The glass round the Alert, which is clear: its own card colour
          outranked the glass on the same element, and it read white. */}
      <div className={cn(GLASS, "pointer-events-auto w-fit max-w-full rounded-[22px]")}>
      {/* A row of its own, 44 tall as a list's row is: the line and its
          Retry, not a control grown to its hit area. */}
      <Alert
        variant="destructive" role="status"
        className="flex min-h-11 items-center gap-2 rounded-[22px] border-transparent bg-transparent py-1 pr-1 pl-3 text-destructive-ink *:[svg]:translate-y-0"
      >
        <CircleAlert className="shrink-0" />
        <button
          type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="problem-banner-title"
          // The line's whole height, so its 44-point hit area is its own:
          // a 28-point box's reached past the glass round it.
          className={cn("flex min-w-0 flex-1 flex-col justify-center self-stretch py-1 text-left font-medium outline-none focus-visible:underline", TEXT.detail)}
        >
          {open && problems.length > 1
            ? problems.map(p => <span key={p.id} className="ml-4 list-item list-disc" data-problem-item="">{p.title}</span>)
            : <span className={cn("block max-w-full", !open && "truncate")}>{title}</span>}
        </button>
        {retries.length > 0 && (
          <Button
            type="button" size="sm" variant="ghost" className="shrink-0 rounded-full text-tint"
            onClick={() => retries.forEach(p => p.retry!())}
          >
            Try again
          </Button>
        )}
      </Alert>
      </div>
    </div>
  );
}
