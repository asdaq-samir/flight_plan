import MapGuideButton from "../../../components/MapGuideButton";
import { Kbd } from "../../../components/ui/kbd";
import { scoreColor } from "../format";

const BUCKETS: [string, string][] = [
  [scoreColor(4.5), "4.5+ — excellent"],
  [scoreColor(4.0), "4.0–4.5 — good"],
  [scoreColor(3.5), "3.5–4.0 — fair"],
  [scoreColor(3.0), "3.0–3.5 — weak"],
  [scoreColor(0), "below 3.0 — poor"],
];

/**
 * What this page is and what the map's dot colors mean --
 * `MapGuideButton`'s own shell (shared with Label's `RatingLegend`)
 * around this page's own content. MapLegend, the card this replaces,
 * went out with the sidebar simplification along with a fit/basemap
 * button pair that keyboard shortcuts already covered -- only the
 * color key itself was worth keeping, and it had nowhere left to live
 * once the sidebar became checkpoints-only.
 */
export default function ScoreLegend() {
  return (
    <MapGuideButton ariaLabel="Planning guide" contentClassName="w-64">
      {/* What the app does, in one line -- used to be its own hero
          section on the Settings page (a leftover from when Settings
          was Plan's own front door); moved here instead, since a
          pilot looking for "what is this" reaches for this icon, not
          Settings. Minimal on purpose -- the full pitch (the 4-step
          diagram) isn't worth the room in a popover this size. */}
      <p className="text-muted-foreground">
        Two airport idents in; a charted course, ML-scored checkpoints, a nav log and briefing out.
      </p>
      <div className="space-y-1 border-t border-border pt-2">
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
    </MapGuideButton>
  );
}
