import { Button } from "../../../components/ui/button";
import { cn } from "cn";
import { TEXT } from "../../../lib/text";
import type { Unflyable } from "../hooks/usePlan";
import { FINDING_TONE } from "../../../lib/status";

/**
 * No legal altitude for the route: where along it, why as a list, and the
 * ways on -- a stop to route round the high ground (or an altitude of the
 * pilot's own, the cruising altitude's Custom row beside this) -- or,
 * where Class B airspace is what stops it, Fly via (the stop picker, the
 * waypoints round it suggested at its top) and Accept Class B, planned
 * through it for a pilot who will have the clearance. In the cruising
 * altitude's chip, red, at the pilot's ask (AltitudeGroup): it was a
 * mark beside the Nav Log's title, and before that a line under the
 * route. At rest the route's capsule says so in its chip (PlanWorkspace).
 */
export default function RouteProblem({ problem, onAddStop, onFlyVia, onAcceptClassB, onGoRound }: {
  problem: Unflyable;
  onAddStop: () => void;
  onFlyVia: () => void;
  onAcceptClassB: () => void;
  /** The way round high ground the airplane cannot climb over, all its
   *  points put in at once (the planner's detour with `via`). */
  onGoRound?: (via: string[], stopIndex: number) => void;
}) {
  // At the owner's ask ("Suggest a way around the terrain ... Yes build
  // it"): where the airplane's ceiling is what stops it over high ground,
  // the planner's way round, its points named, a tap putting them all in.
  const round = problem.detours.find(d => d.via && d.via.length > 0);
  return (
    <div className="space-y-3" data-testid="route-problem">
      <p className={cn("font-semibold", FINDING_TONE.stop, TEXT.row)}>{problem.title}</p>
      {problem.reasons.length > 0 && (
        <ul className={cn("list-disc space-y-0.5 pl-4", TEXT.detail)}>
          {problem.reasons.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {problem.classB ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={onFlyVia} data-testid="unflyable-fly-via">Fly via…</Button>
          <Button type="button" size="sm" variant="outline" onClick={onAcceptClassB} data-testid="unflyable-accept-class-b">
            Accept Class B
          </Button>
        </div>
      ) : round && onGoRound ? (
        <div className="space-y-2">
          <p className={cn("text-muted-foreground", TEXT.detail)} data-testid="unflyable-way-round">
            By {round.via!.join(", ")} · +{Math.round(round.added_nm)} nm
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => onGoRound(round.via!, round.stop_index)} data-testid="unflyable-go-round">
              Go round the high ground
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onAddStop} data-testid="unflyable-add-stop">
              Add a stop
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={onAddStop} data-testid="unflyable-add-stop">
          Add a stop
        </Button>
      )}
    </div>
  );
}
