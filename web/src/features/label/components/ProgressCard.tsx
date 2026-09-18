import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import type { Point } from "../../../lib/api/types";
import FilterBar from "./FilterBar";
import type { FilterKey, Filters } from "../logic";

interface Props {
  visiblePicks: Point[];
  filters: Filters;
  onFilterChange: (key: FilterKey, on: boolean) => void;
  filterCounts: Record<FilterKey, number>;
  shown: number;
  canUndo: boolean;
  onUndo: () => void;
  onResetAll: () => void;
}

export default function ProgressCard({
  visiblePicks, filters, onFilterChange, filterCounts, shown, canUndo, onUndo, onResetAll,
}: Props) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Selected <span className="font-normal text-muted-foreground">{shown}</span></CardTitle>
      </CardHeader>
      <CardContent>
        {/* The view filters used to sit in their own row above this
            card -- moved in here instead, since a checkbox and the
            count it decides between are one fact, not two things a
            reader has to line up across two panels themselves. */}
        <FilterBar filters={filters} onChange={onFilterChange} counts={filterCounts} />
        <div className="mt-2 flex gap-2 border-t border-border pt-2 text-sm">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="rounded px-2 py-1 text-muted-foreground disabled:opacity-30 enabled:hover:bg-accent"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => {
              // Bulk and only reversible one point at a time (this isn't
              // itself an undo step), so a stray tap can't wipe a leg's
              // worth of ratings with nothing to walk it back with.
              if (window.confirm("Reset every rating on this route? This can't be undone.")) onResetAll();
            }}
            disabled={visiblePicks.length === 0}
            className="rounded px-2 py-1 text-destructive disabled:opacity-30 enabled:hover:bg-destructive/10"
          >
            Reset all
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
