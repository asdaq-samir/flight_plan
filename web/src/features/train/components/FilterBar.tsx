import { Check } from "lucide-react";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import type { FilterKey, Filters } from "../logic";

interface Props {
  filters: Filters;
  onChange: (key: FilterKey, on: boolean) => void;
  counts: Record<FilterKey, number>;
}

// Three independent axes (role, source, status) that all have to admit
// a point: a group each, the two choices a row each, said in words --
// "DR" alone was the only name the role had.
const AXES: [string, [FilterKey, string][]][] = [
  ["Role", [["dr", "On course (DR)"], ["visual", "Off course (visual)"]]],
  ["Source", [["detected", "Found on the chart"], ["added", "Added by hand"]]],
  ["Status", [["rated", "Rated"], ["unrated", "Not rated yet"]]],
];

/** Which waypoints to show and count -- the body of the waypoint
 *  drawer's own Filters sheet, as an iOS list of choices: a row each,
 *  a tap turns it on or off, a checkmark when it is on, and its count
 *  at the end. Each count is over every candidate, on or off (see
 *  `filterCounts`), so a row turned off still says what turning it back
 *  on would surface. It was a grid of checkboxes, a control iOS does not
 *  have, with the counts in brackets. */
export default function FilterBar({ filters, onChange, counts }: Props) {
  return (
    <div className="space-y-4">
      {AXES.map(([axis, keys]) => (
        <ListGroup key={axis} title={axis}>
          {keys.map(([key, label]) => (
            <ListRow
              key={key} title={label} value={counts[key]}
              role="checkbox" aria-checked={filters[key]} data-testid={`filter-${key}`}
              onClick={() => onChange(key, !filters[key])}
            >
              <Check aria-hidden className={filters[key] ? "size-4 text-primary" : "size-4 invisible"} />
            </ListRow>
          ))}
        </ListGroup>
      ))}
    </div>
  );
}
