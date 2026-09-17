import { useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import Row from "../../../components/Row";
import { Badge } from "../../../components/ui/badge";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import { COLORS, compassPoint, roleOf, type WalkEntry } from "../logic";

interface Props {
  entries: WalkEntry[];
  selected: Point | null;
  onFocus: (entry: WalkEntry) => void;
  hidden: number;
  bearingDeg: number;
  departureIdent: string;
}

export default function WaypointList({
  entries, selected, onFocus, hidden, bearingDeg, departureIdent,
}: Props) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Selecting a point on the map (or by stepping) should be as visible
  // here as clicking the row itself would have been -- otherwise the
  // highlighted row can be scrolled out of view and looks like nothing
  // happened.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Numbered separately from `entry.index` (which is an index into
  // detections/added, not into this list): endpoints don't get a
  // number, so this counts only the waypoints between them, matching
  // the "n of total" the map popup shows for the same point. Computed
  // as its own pass, not a running counter mutated inside the
  // JSX-producing .map() below -- that would tie each row's render to
  // every prior row's having already run in order, which is exactly
  // the kind of per-item independence React (and its compiler) assumes
  // it can rely on.
  const waypointNumbers = new Map<WalkEntry, number>();
  let waypointCount = 0;
  for (const entry of entries) {
    if (!isEndpoint(entry.point)) waypointNumbers.set(entry, ++waypointCount);
  }

  return (
    <Card size="sm" className="min-h-0 flex-1 overflow-y-auto">
      <CardHeader>
        <CardTitle>Waypoints</CardTitle>
      </CardHeader>
      <CardContent>
      {/* Marks the scope the keyboard handler checks to tell "arrows
          should walk this list" apart from "arrows should walk the
          map" -- set once focus lands inside here (a row is
          focusable), not on hover, so it survives scrolling. */}
      <div data-waypoint-list>
      {entries.map(entry => {
        const p = entry.point;
        const selectedHere = p === selected;
        if (isEndpoint(p)) {
          return (
            <Row
              key={`e${entry.index}`}
              ref={selectedHere ? selectedRef : undefined}
              selected={selectedHere}
              onClick={() => onFocus(entry)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span>{p.ident}</span>
                <Badge style={{ backgroundColor: "#142430", color: "white" }}>
                  {p.category === "departure" ? "DEP" : "DEST"}
                </Badge>
              </div>
              <div className="text-sm text-slate-500">{p.name}</div>
            </Row>
          );
        }
        const rating = (p as { rating: Rating }).rating;
        return (
          <Row
            key={`${entry.kind}${entry.index}`}
            ref={selectedHere ? selectedRef : undefined}
            selected={selectedHere}
            onClick={() => onFocus(entry)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span>
                <span className="text-xs text-slate-400">{waypointNumbers.get(entry)}.</span>{" "}
                {(p as { category: string }).category}
              </span>
              <span className="flex items-center gap-1">
                {/* DR is the common case and doesn't earn a badge; a
                    visual point is the exception worth flagging. */}
                {roleOf(p) === "visual" && (
                  <Badge style={{ backgroundColor: "#7b3fa0", color: "white" }}>visual</Badge>
                )}
                <Badge style={{ backgroundColor: COLORS[rating], color: "white" }}>{rating}</Badge>
              </span>
            </div>
            <div className="text-sm text-slate-500">
              {p.along_track_nm.toFixed(1)} nm {compassPoint(bearingDeg)} of {departureIdent}
            </div>
            <div className="text-sm text-slate-500">{p.lat.toFixed(4)}, {p.lon.toFixed(4)}</div>
          </Row>
        );
      })}
      </div>
      {hidden > 0 && (
        <div className="pt-2 text-sm text-slate-500">
          {hidden} waypoint{hidden === 1 ? "" : "s"} unselected — tick to show
        </div>
      )}
      </CardContent>
    </Card>
  );
}
