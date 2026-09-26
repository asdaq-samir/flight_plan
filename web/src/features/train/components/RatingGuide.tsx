import { Badge } from "../../../components/ui/badge";
import type { Rating } from "../../../lib/api/types";
import { inkOn } from "../../../lib/scoreScale";
import { COLORS } from "../logic";

const SCALE: [Rating, string, string][] = [
  [0, "Not a feature.", "Contour, boundary, chart text. The detector is wrong."],
  [1, "", "Real, but you’d never use it. One creek among a dozen."],
  [2, "", "You’d have to hunt, and might not be sure you found it."],
  [3, "", "Workable. Findable, but confusable with something nearby."],
  [4, "", "You’d expect to spot it and be confident."],
  [5, "", "Unmistakable. On the nav log without a second thought."],
];

/**
 * The rating scale and the keyboard shortcuts for rating: what a
 * developer reads before walking a route. It lives in the Developer
 * drawer's own "rate its checkpoints" step (see DevPanel),
 * beside the instructions for it, rather than behind an info button
 * in the header the way the planner's own score key does.
 */
export default function RatingGuide() {
  return (
    <div className="space-y-3 text-sm">
      <p className="italic text-muted-foreground">
        Flying this leg, would I look up and know <i>that&rsquo;s the one</i> — not one like it?
      </p>
      <div className="space-y-1">
        {SCALE.map(([n, lead, text]) => (
          <div key={n} className="flex items-start gap-2">
            <Badge style={{ backgroundColor: COLORS[n], color: inkOn(COLORS[n]) }}>{n}</Badge>
            <span>{lead && <b>{lead}</b>} {text}</span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground">
        <b>0 vs 1 matters most</b> — 0 means the detector should never have surfaced it,
        1 means it&rsquo;s real but poor. <b>Ignore spacing</b>; selection already enforces
        separation. <b>Judge at this zoom</b>.
      </p>
    </div>
  );
}
