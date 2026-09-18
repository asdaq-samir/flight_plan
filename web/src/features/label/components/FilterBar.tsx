import { Fragment } from "react";
import { Checkbox } from "../../../components/ui/checkbox";
import { FILTER_KEYS, type FilterKey, type Filters } from "../logic";

interface Props {
  filters: Filters;
  onChange: (key: FilterKey, on: boolean) => void;
  counts: Record<FilterKey, number>;
}

// FILTER_KEYS is three pairs, each its own independent axis (role,
// source, status) that all have to admit a point -- a divider before
// the first key of the second and third pair marks that grouping,
// which a flat row of six checkboxes otherwise doesn't show at all.
const DIVIDER_BEFORE = new Set<FilterKey>(["detected", "rated"]);

export default function FilterBar({ filters, onChange, counts }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm" title="Which waypoints to show and count">
      {FILTER_KEYS.map(key => (
        <Fragment key={key}>
          {DIVIDER_BEFORE.has(key) && (
            <span aria-hidden className="mx-1 h-4 w-px self-stretch bg-border" />
          )}
          <label htmlFor={`filter-${key}`} className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent active:bg-accent">
            <Checkbox id={`filter-${key}`} checked={filters[key]} onCheckedChange={c => onChange(key, c === true)} />
            {key === "dr" ? "DR" : key} <span className="text-muted-foreground">({counts[key]})</span>
          </label>
        </Fragment>
      ))}
    </div>
  );
}
