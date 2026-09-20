import { Checkbox } from "../../../components/ui/checkbox";
import type { FilterKey, Filters } from "../logic";

interface Props {
  filters: Filters;
  onChange: (key: FilterKey, on: boolean) => void;
  counts: Record<FilterKey, number>;
}

// Three independent axes (role, source, status) that all have to admit
// a point -- one named row each, rather than six checkboxes in a row
// whose grouping a reader had to work out from divider lines.
const AXES: [string, FilterKey, FilterKey][] = [
  ["Role", "dr", "visual"],
  ["Source", "detected", "added"],
  ["Status", "rated", "unrated"],
];

const LABEL: Record<FilterKey, string> = {
  dr: "DR", visual: "visual", detected: "detected", added: "added", rated: "rated", unrated: "unrated",
};

/** Which waypoints to show and count -- the body of the waypoint
 *  drawer's own Filters popover. Each count is over every candidate,
 *  on or off (see `filterCounts`), so an unticked box still says what
 *  ticking it would surface. */
export default function FilterBar({ filters, onChange, counts }: Props) {
  return (
    <div className="space-y-1 text-sm">
      <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Show</div>
      {AXES.map(([axis, a, b]) => (
        <div key={axis} className="flex items-center gap-1">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">{axis}</span>
          {[a, b].map(key => (
            <label
              key={key} htmlFor={`filter-${key}`}
              className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent active:bg-accent"
            >
              <Checkbox id={`filter-${key}`} checked={filters[key]} onCheckedChange={c => onChange(key, c === true)} />
              {LABEL[key]} <span className="text-muted-foreground">({counts[key]})</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
