import { Fragment } from "react";
import { Badge } from "../../../components/ui/badge";
import { Checkbox } from "../../../components/ui/checkbox";
import { FILTER_KEYS, type FilterKey, type Filters } from "../logic";

interface Props {
  filters: Filters;
  onChange: (key: FilterKey, on: boolean) => void;
  shown: number;
}

// FILTER_KEYS is three pairs, each its own independent axis (role,
// source, status) that all have to admit a point -- a divider before
// the first key of the second and third pair marks that grouping,
// which a flat row of six checkboxes otherwise doesn't show at all.
const DIVIDER_BEFORE = new Set<FilterKey>(["detected", "rated"]);

export default function FilterBar({ filters, onChange, shown }: Props) {
  return (
    // One flat flex-wrap row, not checkboxes nested in their own wrapper --
    // a nested wrapper sizes itself off its own widest wrapped line and
    // gets treated as a single item by the outer row, which pushes
    // "Showing" onto a line of its own instead of wrapping in wherever
    // there's room, same as any other item here.
    <div className="flex flex-wrap items-center gap-1 text-sm" title="Which waypoints to show and count">
      {FILTER_KEYS.map(key => (
        <Fragment key={key}>
          {DIVIDER_BEFORE.has(key) && (
            <span aria-hidden className="mx-1 h-4 w-px self-stretch bg-border" />
          )}
          <label htmlFor={`filter-${key}`} className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent active:bg-accent">
            <Checkbox id={`filter-${key}`} checked={filters[key]} onCheckedChange={c => onChange(key, c === true)} />
            {key === "dr" ? "DR" : key}
          </label>
        </Fragment>
      ))}
      <Badge variant="secondary" className="ml-auto">Showing {shown}</Badge>
    </div>
  );
}
