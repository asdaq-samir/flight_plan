import { useQuery } from "@tanstack/react-query";
import MapGuideButton from "../../../components/MapGuideButton";
import TacOverlayToggle from "../../../components/TacOverlayToggle";
import { Kbd } from "../../../components/ui/kbd";
import { api } from "../../../lib/api/client";
import { scoreColor } from "../format";

const BUCKETS: [string, string][] = [
  [scoreColor(4.5), "4.5+ — excellent"],
  [scoreColor(4.0), "4.0–4.5 — good"],
  [scoreColor(3.5), "3.5–4.0 — fair"],
  [scoreColor(3.0), "3.0–3.5 — weak"],
  [scoreColor(0), "below 3.0 — poor"],
];

// One row each, key then what it does -- the same shape Label's own
// `RatingLegend` lists its shortcuts in (`[string | null, string][]`,
// `null` for a description with no key of its own), rather than two
// crammed onto one line separated by "·". Kept here as data instead of
// written inline so this list can't quietly drift from PlanView's own
// keydown handler the way "n" used to (its own row here read "map /
// nav log" long after "n" started toggling the Map/Brief tabs instead,
// and the arrow keys' own waypoint-stepping wasn't listed at all).
const SHORTCUTS: [string | null, string][] = [
  ["a", "all candidates"],
  ["n", "map / brief"],
  ["f", "fit route"],
  ["t", "toggle FAA / OSM"],
  ["↑↓", "step waypoints"],
];

/** Which model scored the checkpoints on the map, and how good it is
 *  -- the one thing about the ML a pilot might reasonably ask. The same
 *  data the dev console charts in full; here it is one line,
 *  and nothing at all while it is loading or when no model has been
 *  promoted yet (a fresh checkout answers 404). */
function ModelProvenance() {
  const { data } = useQuery({
    queryKey: ["modelComparison"], queryFn: api.modelComparison, retry: false, staleTime: Infinity,
  });
  const promoted = data?.models.find(m => m.promoted);
  if (!data || !promoted) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Scored by {promoted.name}
      {promoted.score !== null && ` · MAE ${promoted.score.toFixed(2)}`}
      {data.n_labeled != null && ` on ${data.n_labeled} labelled checkpoints`}
    </p>
  );
}

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
    <MapGuideButton ariaLabel="Info" contentClassName="w-64">
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
        <ModelProvenance />
      </div>
      <TacOverlayToggle />
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
