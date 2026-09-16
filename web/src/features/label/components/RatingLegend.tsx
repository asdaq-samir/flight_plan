import Badge from "../../../components/Badge";
import GuidePanel from "../../../components/GuidePanel";
import Key from "../../../components/Key";
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
 * The rating scale and keyboard shortcuts, pinned to the bottom-right
 * corner of the map rather than the sidebar -- it's about the map, so
 * it opens over it. The action button (Start/Resume/Fit line) takes
 * the opposite corner, bottom-left, the same split the planner uses
 * for its own guide/toggle pair. `GuidePanel` is the shared shell
 * (position, open/closed panel, toggle button) both pages' guides use;
 * this is just the label page's own content for it.
 */
export default function RatingLegend({ bottomOffset }: { bottomOffset?: number }) {
  return (
    <GuidePanel width="w-72" buttonLabel="Labeling Guide" bottomOffset={bottomOffset}>
      <div className="space-y-3 text-sm">
        <p className="italic text-slate-600">
          Flying this leg, would I look up and know <i>that&rsquo;s the one</i> — not one like it?
        </p>
        <div className="space-y-1">
          {SCALE.map(([n, lead, text]) => (
            <div key={n} className="flex items-start gap-2">
              <Badge color={COLORS[n]}>{n}</Badge>
              <span>{lead && <b>{lead}</b>} {text}</span>
            </div>
          ))}
        </div>
        <p className="text-slate-600">
          <b>0 vs 1 matters most</b> — 0 means the detector should never have surfaced it,
          1 means it&rsquo;s real but poor. <b>Ignore spacing</b>; selection already enforces
          separation. <b>Judge at this zoom</b>.
        </p>
        <div className="space-y-1.5 border-t border-slate-200 pt-2 text-slate-600">
          {SHORTCUTS.map(([key, text]) => (
            <div key={text} className="flex items-center gap-2">
              {key && <Key>{key}</Key>}
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </GuidePanel>
  );
}
