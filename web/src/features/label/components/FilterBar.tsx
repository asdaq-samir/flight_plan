import { Checkbox } from "../../../components/ui/checkbox";
import type { FilterKey, Filters } from "../logic";

interface Props {
  filters: Filters;
  onChange: (key: FilterKey, on: boolean) => void;
  counts: Record<FilterKey, number>;
}

// Three independent axes (role, source, status) that all have to admit
// a point -- one named block each, rather than six checkboxes in a row
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
 *  ticking it would surface. Each axis is a heading over two equal
 *  columns: a label beside the pair ran the widest row ("detected
 *  (343) added (13)") past the popover's edge, and a column each is
 *  what keeps a three-digit count on its own line whatever the width. */
export default function FilterBar({ filters, onChange, counts }: Props) {
  return (
    <div className="space-y-2 text-sm">
      {AXES.map(([axis, a, b]) => (
        <div key={axis}>
          <div className="text-xs font-semibold uppercase text-muted-foreground">{axis}</div>
          <div className="grid grid-cols-2 gap-x-1">
            {[a, b].map(key => (
              <label
                key={key} htmlFor={`filter-${key}`}
                className="inline-flex items-center gap-1.5 rounded px-1 py-1 whitespace-nowrap hover:bg-accent active:bg-accent"
              >
                <Checkbox id={`filter-${key}`} checked={filters[key]} onCheckedChange={c => onChange(key, c === true)} />
                {LABEL[key]} <span className="text-muted-foreground">({counts[key]})</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
