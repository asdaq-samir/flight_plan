import { useQuery } from "@tanstack/react-query";
import KeepRoute from "../../components/KeepRoute";
import { Kbd } from "../../components/ui/kbd";
import { api } from "../../lib/api/client";
import type { Course } from "../../lib/api/types";
import { scoreColor } from "../plan/format";

const BUCKETS: [string, string][] = [
  [scoreColor(4.5), "4.5 and up: you will see it and know it"],
  [scoreColor(4.0), "4 to 4.5: you should spot it without hunting"],
  [scoreColor(3.5), "3.5 to 4: findable, but easy to confuse with something nearby"],
  [scoreColor(3.0), "3 to 3.5: weak; keep a second reference"],
  [scoreColor(0), "below 3: not one to plan on"],
];

const KEYS: [string, string][] = [
  ["n", "open the flight planning drawer, and close it"],
  ["f", "fit the whole route"],
  ["a", "show every landmark the model rated, not only the chosen ones"],
  ["↑↓", "step through the checkpoints"],
];

/** Which model rated the checkpoints, in one line a pilot might
 *  reasonably want -- nothing at all while it loads or when no model
 *  has been promoted yet. */
function ModelProvenance() {
  const { data } = useQuery({
    queryKey: ["modelComparison"], queryFn: api.modelComparison, retry: false, staleTime: Infinity,
  });
  const promoted = data?.models.find(m => m.promoted);
  if (!data || !promoted) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Rated by {promoted.name}
      {promoted.score !== null && `, off by ${promoted.score.toFixed(2)} on average`}
      {data.n_labeled != null && ` against ${data.n_labeled} checkpoints pilots rated by hand`}.
    </p>
  );
}

/**
 * The planner explained to the pilot, the Pilot drawer's Guide tab:
 * what to do, in order; what the colours on the chart mean; what the
 * map's own controls do; keeping the route for the air; and the keys.
 * This is what the header's info popover used to hold, written for the
 * pilot rather than for whoever built it.
 */
export default function PilotGuide({ course }: { course: Course | null }) {
  return (
    <div className="space-y-5">
      <section className="space-y-1.5 text-sm">
        <h3 className="text-sm font-semibold">Planning a flight here</h3>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Pick your departure and destination in the header and press the arrow. The course draws at once.</li>
          <li>The numbered dots along the course are your visual checkpoints: landmarks a pilot could pick out from the air, chosen and rated for that.</li>
          <li>Open Flight Planning from the header and pick your aeroplane and departure time at the top. Each section opens on its title: the nav log has the legs with headings, times and fuel for them and the winds, and the briefing sections follow it: weather, NOTAMs, the airports. Print it from there.</li>
          <li>Tap a checkpoint or its row for how to spot it, and add your own note.</li>
        </ol>
      </section>

      <section className="space-y-1.5 text-sm">
        <h3 className="text-sm font-semibold">What the colours mean</h3>
        <p className="text-muted-foreground">Each checkpoint is rated for how findable it is from the cockpit, 0 to 5.</p>
        <div className="space-y-1">
          {BUCKETS.map(([color, label]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <ModelProvenance />
      </section>

      <section className="space-y-1.5 text-sm">
        <h3 className="text-sm font-semibold">The map</h3>
        <p className="text-muted-foreground">
          The chart is the FAA sectional, the whole country, at every zoom. The layers button at the map's top right
          picks the base chart (sectional, IFR low, IFR high), pins the terminal area chart over it, and turns on your own
          position. Close in over a terminal area a pin appears on the map to pin that sheet. The zoom button under it
          swaps between the whole route and the selected checkpoint.
        </p>
      </section>

      <section className="space-y-1.5 text-sm">
        <h3 className="text-sm font-semibold">On your phone</h3>
        <p className="text-muted-foreground">
          Add this to your Home Screen and it opens as its own app: the whole screen, with no browser bar over the
          chart, and the charts you keep below stay kept. In Safari tap Share, then Add to Home Screen. In a browser
          tab the address bar stays put, because the page holds still under your finger rather than scrolling.
        </p>
      </section>

      <KeepRoute course={course} />

      <section className="space-y-1.5 text-sm">
        <h3 className="text-sm font-semibold">Keys</h3>
        <div className="space-y-1 text-muted-foreground">
          {KEYS.map(([key, text]) => (
            <div key={key} className="flex items-center gap-2">
              <Kbd>{key}</Kbd>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
