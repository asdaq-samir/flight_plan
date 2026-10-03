import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "cn";
import { TEXT } from "../../../lib/text";
import type { Unflyable } from "../hooks/usePlan";
import TitleNote from "./navlog/TitleNote";

/**
 * No legal altitude for the route, as a red mark and its words beside
 * the Nav Log's title (TitleNote) that opens to where along the route,
 * why as a list, and the ways on: a stop to route round the high ground
 * or an altitude of the pilot's own to plan it anyway -- or, where Class
 * B airspace is what stops it, Fly via (the stop picker, the waypoints
 * round it suggested at its top) and Accept Class B, planned through it
 * for a pilot who will have the clearance. At rest the route's capsule
 * says so in its chip (PlanWorkspace). It was a line under the route,
 * opening in place.
 */
export default function RouteProblem({ problem, onAddStop, onFly, onFlyVia, onAcceptClassB }: {
  problem: Unflyable;
  onAddStop: () => void;
  onFly: (feet: string) => void;
  onFlyVia: () => void;
  onAcceptClassB: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [feet, setFeet] = useState("");
  // Each way on puts this away first: the stop picker opens over it.
  const then = (action: () => void) => () => { setOpen(false); action(); };
  return (
    <TitleNote
      tone="destructive" label="No legal altitude" title="No legal altitude" open={open} onOpenChange={setOpen}
      testId="route-problem-title" contentTestId="route-problem"
    >
      <div className="space-y-3">
        <p className={cn("font-semibold text-red-700 dark:text-red-400", TEXT.row)}>{problem.title}</p>
        {problem.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4">
            {problem.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        {problem.classB ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={then(onFlyVia)} data-testid="unflyable-fly-via">Fly via…</Button>
            <Button type="button" size="sm" variant="outline" onClick={then(onAcceptClassB)} data-testid="unflyable-accept-class-b">
              Accept Class B
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={then(onAddStop)} data-testid="unflyable-add-stop">
              Add a stop
            </Button>
            <form
              className="flex min-w-0 flex-1 items-center gap-2" aria-label="Custom altitude"
              onSubmit={e => { e.preventDefault(); if (feet) then(() => onFly(feet))(); }}
            >
              <Input
                value={feet} onChange={e => setFeet(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric" placeholder="Altitude, ft" aria-label="Cruise altitude, feet"
                className="h-8 min-w-24 flex-1" data-testid="unflyable-altitude"
              />
              <Button type="submit" size="sm" disabled={!feet} data-testid="unflyable-fly">Fly</Button>
            </form>
          </div>
        )}
      </div>
    </TitleNote>
  );
}
