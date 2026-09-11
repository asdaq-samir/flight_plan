import Card from "../../../components/Card";
import type { Point } from "../../../lib/api/types";
import { roleOf, sourceOf } from "../logic";

export default function ProgressCard({ visiblePicks }: { visiblePicks: Point[] }) {
  const count = (pred: (p: Point) => boolean) => visiblePicks.filter(pred).length;
  return (
    <Card title={<>Rated <span className="font-normal text-slate-500">{visiblePicks.length}</span></>}>
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
    </Card>
  );
}
