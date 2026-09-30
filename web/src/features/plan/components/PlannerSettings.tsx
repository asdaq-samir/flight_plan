import OwnShipControls from "../../../components/OwnShipControls";
import { Checkbox } from "../../../components/ui/checkbox";
import { Label } from "../../../components/ui/label";

/**
 * What the planner adds to the header's settings: every landmark the
 * model rated, not only the ones it chose -- the planner's own switch,
 * which used to be the `a` key and had nowhere to be clicked -- and own
 * ship. The training page adds nothing.
 */
export default function PlannerSettings({ candidates }: { candidates: { on: boolean; onToggle: (on: boolean) => void } }) {
  return (
    <>
      <div className="space-y-2 border-t border-border pt-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checkpoints</div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-candidates"
            checked={candidates.on}
            onCheckedChange={value => candidates.onToggle(value === true)}
            data-testid="candidates-toggle"
          />
          <Label htmlFor="show-candidates" className="font-normal">Every landmark the model rated</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          The small dim dots beside the numbered ones: what the chosen checkpoints were chosen from.
        </p>
      </div>
      <OwnShipControls />
    </>
  );
}
