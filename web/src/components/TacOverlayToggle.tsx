import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { useTacOverlay } from "../lib/map/tacOverlay";

/**
 * The one map-layer setting: draw the FAA terminal area chart over the
 * sectional at every zoom it can be drawn at, wherever one exists
 * (Chicago's covers the first leg out of C81). Past the sectional's own
 * resolution the TAC is drawn regardless (see `createBasemaps`), so
 * this only decides whether it also replaces the sectional further
 * out. Lives in both pages' info popovers -- Plan's `ScoreLegend` and
 * Label's `RatingLegend` -- next to the shortcut list, since that
 * popover is already where the map's own controls are explained. Off
 * by default: a TAC is busier than the sectional, and most of a
 * cross-country is flown off the sectional.
 */
export default function TacOverlayToggle() {
  const [enabled, setEnabled] = useTacOverlay();
  return (
    <div className="space-y-1.5 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Chart layers</div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="tac-overlay"
          checked={enabled}
          onCheckedChange={value => setEnabled(value === true)}
          data-testid="tac-toggle"
        />
        <Label htmlFor="tac-overlay" className="font-normal">Terminal area chart as soon as it can be drawn</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Past the sectional&rsquo;s own detail the terminal chart is drawn regardless, where one exists.
      </p>
    </div>
  );
}
