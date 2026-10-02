import { useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { TEXT } from "../../../lib/text";
import type { Unflyable } from "../hooks/usePlan";

/**
 * No legal altitude for the route, said in the route's own panel, under
 * it, as Maps says a route it cannot find in its own card: one line --
 * where along the route -- that opens in place to why, as a list, and the
 * two ways on, a stop to route round the high ground or an altitude of
 * the pilot's own to plan it anyway. The stock Alert, closed by default,
 * so it takes a line of the panel and no more until it is asked for.
 * At rest the route's capsule says so in its chip (PlanWorkspace).
 */
export default function RouteProblem({ problem, onAddStop, onFly }: {
  problem: Unflyable;
  onAddStop: () => void;
  onFly: (feet: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [feet, setFeet] = useState("");
  return (
    <Alert
      variant="destructive" data-testid="route-problem"
      className="rounded-none border-x-0 border-t-0 bg-transparent px-4 py-2 *:[svg]:translate-y-1"
    >
      <CircleAlert />
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="route-problem-title"
        className={cn("col-start-2 flex min-w-0 items-center gap-2 text-left font-medium outline-none focus-visible:underline", TEXT.row)}
      >
        <span className={cn("min-w-0 flex-1", !open && "truncate")}>{problem.title}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {/* Why in the words' own colour: a list in red was hard to read. */}
      {open && (
        <AlertDescription className={cn("col-start-2 space-y-2 pt-1 text-foreground!", TEXT.detail)}>
          {problem.reasons.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {problem.reasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onAddStop} data-testid="unflyable-add-stop">
              Add a stop
            </Button>
            <form
              className="flex min-w-0 flex-1 items-center gap-2" aria-label="Custom altitude"
              onSubmit={e => { e.preventDefault(); if (feet) onFly(feet); }}
            >
              <Input
                value={feet} onChange={e => setFeet(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric" placeholder="Altitude, ft" aria-label="Cruise altitude, feet"
                className="h-8 min-w-24 flex-1 text-foreground" data-testid="unflyable-altitude"
              />
              <Button type="submit" size="sm" disabled={!feet} data-testid="unflyable-fly">Fly</Button>
            </form>
          </div>
        </AlertDescription>
      )}
    </Alert>
  );
}
