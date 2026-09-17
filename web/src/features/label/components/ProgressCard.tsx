import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import type { Point } from "../../../lib/api/types";
import { roleOf, sourceOf } from "../logic";

interface Props {
  visiblePicks: Point[];
  canUndo: boolean;
  onUndo: () => void;
  onResetAll: () => void;
}

export default function ProgressCard({ visiblePicks, canUndo, onUndo, onResetAll }: Props) {
  const count = (pred: (p: Point) => boolean) => visiblePicks.filter(pred).length;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Rated <span className="font-normal text-muted-foreground">{visiblePicks.length}</span></CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-6 text-sm">
          <div>
            <div><b>{count(p => roleOf(p) === "dr")}</b> DR</div>
            <div><b>{count(p => roleOf(p) === "visual")}</b> visual</div>
          </div>
          <div>
            <div><b>{count(p => sourceOf(p) === "detected")}</b> detected</div>
            <div><b>{count(p => sourceOf(p) === "added")}</b> added</div>
          </div>
        </div>
        <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2 text-sm">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="rounded px-2 py-1 text-slate-600 disabled:opacity-30 enabled:hover:bg-slate-100"
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
            className="rounded px-2 py-1 text-red-600 disabled:opacity-30 enabled:hover:bg-red-50"
          >
            Reset all
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
