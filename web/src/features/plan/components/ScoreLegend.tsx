import GuidePanel from "../../../components/GuidePanel";
import Key from "../../../components/Key";
import { scoreColor } from "../format";

const BUCKETS: [string, string][] = [
  [scoreColor(4.5), "4.5+ — excellent"],
  [scoreColor(4.0), "4.0–4.5 — good"],
  [scoreColor(3.5), "3.5–4.0 — fair"],
  [scoreColor(3.0), "3.0–3.5 — weak"],
  [scoreColor(0), "below 3.0 — poor"],
];

/**
 * What the map's dot colors mean, pinned to the bottom-right corner --
 * the same button+panel shell (`GuidePanel`) the label page's own
 * Guide uses, and the same corner: both pages' action buttons are
 * bottom-left, both pages' guides are bottom-right. MapLegend, the
 * card this replaces, went out with the sidebar simplification along
 * with a fit/basemap button pair that keyboard shortcuts already
 * covered -- only the color key itself was worth keeping, and it had
 * nowhere left to live once the sidebar became checkpoints-only.
 */
export default function ScoreLegend({ bottomOffset }: { bottomOffset?: number }) {
  return (
    <GuidePanel width="w-64" buttonLabel="Planning Guide" bottomOffset={bottomOffset}>
      <div className="space-y-3 text-sm">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase text-slate-400">Checkpoint score</div>
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
        <div className="space-y-1 border-t border-slate-200 pt-2 text-slate-600">
          <div><Key>a</Key> all candidates · <Key>n</Key> map / nav log</div>
          <div><Key>f</Key> fit route · <Key>t</Key> toggle FAA / OSM</div>
        </div>
      </div>
    </GuidePanel>
  );
}
