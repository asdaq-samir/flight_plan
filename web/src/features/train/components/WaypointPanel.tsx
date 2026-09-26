import { Fragment } from "react";
import { cn } from "cn";
import { BrainCircuit, Eraser, ListFilter, Undo2 } from "lucide-react";
import { useRetrain } from "../../dev/useRetrain";
import IconButton from "../../../components/IconButton";
import { NoteRow, SelectableRow } from "../../../components/SelectableRows";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import { COLORS, RATINGS, pointKey, prettyCategory, roleOf, type FilterKey, type Filters, type WalkEntry } from "../logic";
import { inkOn } from "../../../lib/scoreScale";


const FILTER_AXES: [string, FilterKey, FilterKey][] = [
  ["Role", "dr", "visual"], ["Source", "detected", "added"], ["Status", "rated", "unrated"],
];
const FILTER_LABEL: Record<FilterKey, string> = {
  dr: "DR", visual: "visual", detected: "detected", added: "added", rated: "rated", unrated: "unrated",
};

interface Props {
  /** Every point the walk can land on, in flight order: the endpoints
   *  and every candidate the filters admit, rated or not -- the same
   *  set, in the same order, the arrow keys step through on the map. */
  entries: WalkEntry[];
  selected: Point | null;
  onFocus: (entry: WalkEntry) => void;
  /** Rates the selected point -- the selected row's own buttons. */
  onRate: (rating: Rating) => void;
  distanceNm: number | null;
  bearingDeg: number;
  departureIdent: string;
  destinationIdent: string;
  /** How far the corridor's labels have come: rated over every
   *  candidate, filters or no filters. */
  rated: number;
  total: number;
  /** How many rated points the filters hold back. */
  hidden: number;
  filters: Filters;
  counts: Record<FilterKey, number>;
  onFilterChange: (key: FilterKey, on: boolean) => void;
  canUndo: boolean;
  onUndo: () => void;
  onResetAll: () => void;
}

const COLUMNS = 4;

/**
 * The developer's waypoint drawer, shaped like the pilot's nav log:
 * a header with the corridor's numbers and the drawer's own actions,
 * then one table walked by selecting a row, with the map following.
 * It is a worklist, not a record: every candidate the filters admit is
 * a row, the unrated ones included, numbered the way the map popup
 * numbers them, with the rating (or a dash) at the end -- the old list
 * showed only what was already rated, which left the actual job, the
 * unrated ones, on the map alone. The selected row opens its own
 * rating buttons underneath, so a corridor can be rated top to bottom
 * from here, on a phone where the map popup sits behind the drawer as
 * much as on a desktop. The filters, one row per axis, live in a
 * popover so the list has the height; Undo and Reset all are icon
 * buttons beside it, the same shape as the nav log's own.
 */
export default function WaypointPanel({
  entries, selected, onFocus, onRate, distanceNm, bearingDeg, departureIdent, destinationIdent,
  rated, total, hidden, filters, counts, onFilterChange, canUndo, onUndo, onResetAll,
}: Props) {
  // Retrain from here, beside Undo and Reset: the ratings this drawer
  // makes are what a retrain learns from, so the button that starts
  // one belongs with them. The dev console's Training Model tab
  // reports the run.
  const retrain = useRetrain();
  // Numbered over the walk with the endpoints skipped -- the same
  // "n of total" the map popup shows for the same point. A separate
  // pass, not a counter mutated inside the JSX map below.
  const numbers = new Map<WalkEntry, number>();
  let count = 0;
  for (const entry of entries) {
    if (!isEndpoint(entry.point)) numbers.set(entry, ++count);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-border p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-muted-foreground" data-testid="drawer-title">Model Training</span>
          <div className="ml-auto flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <IconButton label="Filters" data-testid="waypoint-filters-button">
                  <ListFilter className="size-5" />
                </IconButton>
              </PopoverTrigger>
              {/* w-80: the widest row ("Source detected (343) added
                  (13)") needs the room; a narrower popover clipped its
                  last count. */}
              <PopoverContent align="end" className="w-80">
                <div className="space-y-2 text-sm">
                  {FILTER_AXES.map(([axis, a, b]) => (
                    <div key={axis}>
                      <div className="text-xs font-semibold uppercase text-muted-foreground">{axis}</div>
                      <div className="grid grid-cols-2 gap-x-1">
                        {[a, b].map(key => (
                          <label key={key} htmlFor={`filter-${key}`} className="inline-flex items-center gap-1.5 rounded px-1 py-1 whitespace-nowrap hover:bg-accent active:bg-accent">
                            <Checkbox id={`filter-${key}`} checked={filters[key]} onCheckedChange={v => onFilterChange(key, v === true)} />
                            {FILTER_LABEL[key]} <span className="text-muted-foreground">({counts[key]})</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <IconButton label="Undo" onClick={onUndo} disabled={!canUndo} data-testid="undo-button">
              <Undo2 className="size-5" />
            </IconButton>
            <IconButton
              label="Reset all ratings"
              className="text-destructive hover:text-destructive"
              onClick={onResetAll}
              disabled={rated === 0}
            >
              <Eraser className="size-5" />
            </IconButton>
            <IconButton
              label={retrain.running ? "Retraining…" : retrain.reachable ? "Retrain the model on every rating" : "Retrain (Airflow is not reachable)"}
              onClick={retrain.start}
              disabled={!retrain.canStart}
              data-testid="retrain-button"
            >
              <BrainCircuit className={retrain.running ? "size-5 animate-pulse" : "size-5"} />
            </IconButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {distanceNm !== null && (
            <span><b>{distanceNm} nm</b> · {String(bearingDeg).padStart(3, "0")}°T</span>
          )}
          <span className="text-muted-foreground">
            <b className="text-foreground">{rated}</b> of {total} rated
            {hidden > 0 && ` · ${hidden} hidden by the filters`}
          </span>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        data-testid="waypoint-scroller"
      >
        <Table containerClassName="overflow-visible" className="text-xs whitespace-nowrap">
          <TableCaption className="sr-only">Waypoints from {departureIdent} to {destinationIdent}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 text-right">#</TableHead>
              <TableHead>Waypoint</TableHead>
              <TableHead className="text-right">Dist</TableHead>
              <TableHead className="text-right">Rating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className="text-muted-foreground">No waypoints yet</TableCell>
              </TableRow>
            )}
            {entries.map(entry => {
              const p = entry.point;
              const isSelected = p === selected;
              const key = `${entry.kind}-${pointKey(p)}`;
              if (isEndpoint(p)) {
                return (
                  <Fragment key={key}>
                    <SelectableRow
                      selected={isSelected} mutedWhenUnselected
                      onSelect={() => onFocus(entry)}
                    >
                      <TableCell />
                      <TableCell className="text-left font-medium">{p.ident}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.along_track_nm.toFixed(1)}</TableCell>
                      {/* The end's own badge sits where a waypoint's
                          rating does: an endpoint is never rated, and
                          the column reads as one line of badges.
                          secondary, not default: readable on the plain
                          row and on the inverted (selected) one alike. */}
                      <TableCell className="text-right">
                        <Badge variant="secondary">{p.category === "departure" ? "DEP" : "DEST"}</Badge>
                      </TableCell>
                    </SelectableRow>
                    <NoteRow selected={isSelected} colSpan={COLUMNS}>{p.name}</NoteRow>
                  </Fragment>
                );
              }
              const rating = (p as { rating: Rating | null }).rating;
              const cross = (p as { cross_track_nm?: number }).cross_track_nm ?? 0;
              const visual = roleOf(p) === "visual";
              return (
                <Fragment key={key}>
                  <SelectableRow
                    selected={isSelected}
                    onSelect={() => onFocus(entry)}
                  >
                    <TableCell className={cn("text-right tabular-nums", !isSelected && "text-muted-foreground")}>
                      {numbers.get(entry)}
                    </TableCell>
                    <TableCell className="text-left whitespace-normal">
                      {prettyCategory((p as { category: string }).category)}
                      {/* DR is the common case and doesn't earn a badge;
                          a visual point is the exception worth flagging. */}
                      {visual && (
                        <Badge className="ml-1.5" style={{ backgroundColor: "#7b3fa0", color: "white" }}>visual</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.along_track_nm.toFixed(1)}</TableCell>
                    <TableCell className="text-right">
                      {rating === null
                        ? <span className={cn(!isSelected && "text-muted-foreground")}>—</span>
                        : <Badge style={{ backgroundColor: COLORS[rating], color: inkOn(COLORS[rating]) }}>{rating}</Badge>}
                    </TableCell>
                  </SelectableRow>
                  {/* The selected waypoint's own rating buttons, under
                      it -- the same six the map popup has. Rating from
                      here moves on to the next row, so a corridor rates
                      top to bottom. */}
                  {isSelected && (
                    <NoteRow selected colSpan={COLUMNS}>
                      <div className="flex flex-wrap items-center gap-1 py-0.5">
                        <div className="flex gap-1" role="group" aria-label="Rate this waypoint">
                          {RATINGS.map(r => (
                            <Button
                              key={r} type="button" size="xs"
                              onClick={() => onRate(r)}
                              aria-label={`Rate ${r}`} aria-pressed={rating === r}
                              className={cn(
                                "w-7 font-bold",
                                rating === r ? "ring-2 ring-background" : "opacity-80 hover:opacity-100",
                              )}
                              style={{ backgroundColor: COLORS[r], color: inkOn(COLORS[r]) }}
                            >
                              {r}
                            </Button>
                          ))}
                        </div>
                        <span className="ml-auto text-background/70">
                          {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                          {/* DR points are on the line by definition;
                              the distance only means something for a
                              visual point, picked because it sits off it. */}
                          {visual && ` · ${Math.abs(cross).toFixed(2)} nm off course`}
                        </span>
                      </div>
                    </NoteRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
