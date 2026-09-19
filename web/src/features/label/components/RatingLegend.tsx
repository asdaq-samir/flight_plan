import MapGuideButton from "../../../components/MapGuideButton";
import { Badge } from "../../../components/ui/badge";
import { Kbd } from "../../../components/ui/kbd";
import type { Rating } from "../../../lib/api/types";
import { COLORS } from "../logic";

const SHORTCUTS: [string | null, string][] = [
  ["Space", "start / resume / whole route"],
  ["0–5", "rate"],
  ["↑↓←→", "step the way the course runs"],
  ["Del", "remove"],
  [null, "click the course to add"],
  ["t", "toggle FAA / OSM"],
];

const SCALE: [Rating, string, string][] = [
  [0, "Not a feature.", "Contour, boundary, chart text. The detector is wrong."],
  [1, "", "Real, but you’d never use it. One creek among a dozen."],
  [2, "", "You’d have to hunt, and might not be sure you found it."],
  [3, "", "Workable. Findable, but confusable with something nearby."],
  [4, "", "You’d expect to spot it and be confident."],
  [5, "", "Unmistakable. On the nav log without a second thought."],
];

/**
 * The rating scale and keyboard shortcuts -- `MapGuideButton`'s own
 * shell (shared with the planner's own `ScoreLegend`) around this
 * page's own content, inline next to the sidebar trigger in the header
 * (see LabelView's own comment on where the Start/Resume/Fit line
 * action sits), the same way Plan's `ScoreLegend` does for its own Map
 * tab.
 */
export default function RatingLegend() {
  return (
    <MapGuideButton ariaLabel="Info" contentClassName="w-72">
      <p className="italic text-muted-foreground">
        Flying this leg, would I look up and know <i>that&rsquo;s the one</i> — not one like it?
      </p>
      <div className="space-y-1">
        {SCALE.map(([n, lead, text]) => (
          <div key={n} className="flex items-start gap-2">
            <Badge style={{ backgroundColor: COLORS[n], color: "white" }}>{n}</Badge>
            <span>{lead && <b>{lead}</b>} {text}</span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground">
        <b>0 vs 1 matters most</b> — 0 means the detector should never have surfaced it,
        1 means it&rsquo;s real but poor. <b>Ignore spacing</b>; selection already enforces
        separation. <b>Judge at this zoom</b>.
      </p>
      <div className="space-y-1.5 border-t border-border pt-2 text-muted-foreground">
        {SHORTCUTS.map(([key, text]) => (
          <div key={text} className="flex items-center gap-2">
            {key && <Kbd>{key}</Kbd>}
            <span>{text}</span>
          </div>
        ))}
      </div>
    </MapGuideButton>
  );
}
