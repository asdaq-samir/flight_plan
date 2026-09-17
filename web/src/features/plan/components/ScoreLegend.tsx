import { Info } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Kbd } from "../../../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { scoreColor } from "../format";

const BUCKETS: [string, string][] = [
  [scoreColor(4.5), "4.5+ — excellent"],
  [scoreColor(4.0), "4.0–4.5 — good"],
  [scoreColor(3.5), "3.5–4.0 — fair"],
  [scoreColor(3.0), "3.0–3.5 — weak"],
  [scoreColor(0), "below 3.0 — poor"],
];

/**
 * What the map's dot colors mean, stacked below the sidebar trigger in
 * the map's top-right corner (the same corner the label page's own
 * Guide (`RatingLegend`) uses) -- shadcn's `Popover` directly.
 * `top-36`, not `top-1`: `Shell`'s own `SidebarTrigger` already claims
 * `top-24` there for the exact same reason (clearing the loading
 * toast's own landing zone, see its comment) -- stacking below it,
 * not beside it, keeps both clear without needing a second toast
 * exception of its own. MapLegend, the card this replaces, went out
 * with the sidebar simplification along with a fit/basemap button
 * pair that keyboard shortcuts already covered -- only the color key
 * itself was worth keeping, and it had nowhere left to live once the
 * sidebar became checkpoints-only.
 */
export default function ScoreLegend() {
  return (
    <div className="absolute right-1 top-36 z-[1000]">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            aria-label="Planning guide"
            data-testid="guide-button"
            className="rounded-full border-2 border-background shadow-[0_2px_10px_rgba(0,0,0,.5)]"
          >
            <Info className="size-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-64 z-[1000] max-h-[70vh] overflow-y-auto">
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Checkpoint score</div>
              {BUCKETS.map(([color, label]) => (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: color }}
                  />
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-border pt-2 text-muted-foreground">
              <div><Kbd>a</Kbd> all candidates · <Kbd>n</Kbd> map / nav log</div>
              <div><Kbd>f</Kbd> fit route · <Kbd>t</Kbd> toggle FAA / OSM</div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
