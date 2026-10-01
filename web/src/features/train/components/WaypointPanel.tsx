import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { cn } from "cn";
import { BrainCircuit, Ellipsis, Eraser, ListFilter, Undo2 } from "lucide-react";
import { useRetrain } from "../../dev/useRetrain";
import ToolbarButton from "../../../components/ToolbarButton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { useConfirm } from "../../../components/useConfirm";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Progress } from "../../../components/ui/progress";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import {
  COLORS, RATINGS, pointKey, prettyCategory, roleOf, sourceOf, type FilterKey, type Filters, type WalkEntry,
} from "../logic";
import { revealRow } from "../../../lib/revealRow";
import { inkOn } from "../../../lib/scoreScale";
import { TEXT } from "../../../lib/text";
import FilterBar from "./FilterBar";

interface Props {
  /** Every point the walk can land on, in flight order: the endpoints
   *  and every candidate the filters admit, rated or not -- the same
   *  set, in the same order, the arrow keys step through on the map. */
  entries: WalkEntry[];
  selected: Point | null;
  onFocus: (entry: WalkEntry) => void;
  /** Rates the selected point -- the selected row's own buttons. */
  onRate: (rating: Rating) => void;
  departureIdent: string;
  destinationIdent: string;
  /** How far the corridor's labels have come: rated over every
   *  candidate, filters or no filters. */
  rated: number;
  total: number;
  filters: Filters;
  counts: Record<FilterKey, number>;
  onFilterChange: (key: FilterKey, on: boolean) => void;
  canUndo: boolean;
  onUndo: () => void;
  onResetAll: () => void;
}

/** What the scale's ends and middle mean, under the rating buttons --
 *  the Guide tab's scale (RatingGuide) in one line, each term kept
 *  whole where the line wraps ("· 5" / "unmistakable" read as two). */
const SCALE_KEY = ["0 not a feature", "3 workable", "5 unmistakable"]
  .map(term => term.replaceAll(" ", " ")).join(" · ");

/**
 * The developer's waypoint drawer: a header with how far the rating has
 * got and the drawer's own actions, then the walk as one list, stepped with
 * Up/Down or a tap, the map following. It is a worklist, not a record:
 * every candidate the filters admit is a row, the unrated ones
 * included, numbered the way the map popup numbers them, with the
 * rating (or a dash) at the end -- the old list showed only what was
 * already rated, which left the actual job, the unrated ones, on the
 * map alone. The selected row opens its own rating buttons underneath,
 * so a corridor can be rated top to bottom from here, on a phone where
 * the map popup sits behind the drawer as much as on a desktop.
 *
 * A list as iOS draws one, where it was a table of 12-point columns: a
 * row each, its kind at 17 points and where it is under that at 15 (14
 * and 12 with a mouse: the app's sizes, TEXT), 44 points and more to tap, the
 * selection a tint rather than a black bar. The filters live in a sheet
 * so the list has the height. The header's actions are toolbar buttons,
 * a word under each icon as the nav log's are: Filter and Undo, used
 * all through a walk, and More, which holds what is done once --
 * Retrain, and Reset all ratings in red at the bottom, away from Undo,
 * where it sat beside it as a red eraser.
 */
export default function WaypointPanel({
  entries, selected, onFocus, onRate, departureIdent, destinationIdent,
  rated, total, filters, counts, onFilterChange, canUndo, onUndo, onResetAll,
}: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  // The filters' sheet, closed from its own Done as well as by a tap
  // outside it.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Retrain from here, in More with Reset: the ratings this drawer
  // makes are what a retrain learns from, so the button that starts
  // one belongs with them. The dev console's Training Model tab
  // reports the run.
  const retrain = useRetrain();
  // Bulk and only reversible one point at a time (this isn't itself an
  // undo step), so a stray tap can't wipe a leg's worth of ratings with
  // nothing to walk it back: asked first, in red.
  const [askReset, resetDialog] = useConfirm({
    title: "Reset every rating on this route?",
    description: "Every rating on this route is cleared. This can't be undone.",
    confirmLabel: "Reset all ratings",
    destructive: true,
    onConfirm: onResetAll,
  });
  // Selecting a point on the map (or by stepping) should be as visible
  // here as clicking the row itself would have been -- otherwise the
  // highlighted row can be scrolled out of view and looks like nothing
  // happened. To the middle when it is out of view, left alone when
  // it is not (see revealRow).
  useEffect(() => revealRow(selectedRef.current), [selected]);

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
      <div className={cn("flex flex-col gap-1 border-b border-border p-3 pl-[max(0.75rem,env(safe-area-inset-left))]", TEXT.prose)}>
        {/* Wrapping: with the text set larger the title takes the row
            and the actions go under it, where they used to run off the
            drawer's edge. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-semibold", TEXT.title)} data-testid="drawer-title">Model Training</span>
          <div className="ml-auto flex items-center gap-1">
            <ResponsivePopover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <ResponsivePopoverTrigger asChild>
                <ToolbarButton text="Filter" label="Filters" icon={<ListFilter />} data-testid="waypoint-filters-button" />
              </ResponsivePopoverTrigger>
              <ResponsivePopoverContent
                title="Filters" align="end" className="w-80"
                action={<Button type="button" size="sm" className="-mr-1" onClick={() => setFiltersOpen(false)}>Done</Button>}
              >
                <FilterBar filters={filters} onChange={onFilterChange} counts={counts} />
              </ResponsivePopoverContent>
            </ResponsivePopover>
            <ToolbarButton text="Undo" icon={<Undo2 />} onClick={onUndo} disabled={!canUndo} data-testid="undo-button" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* Pulsing while a retrain runs, as the retrain button did. */}
                <ToolbarButton
                  text="More" label="More actions" data-testid="training-more-button"
                  icon={<Ellipsis className={retrain.running ? "animate-pulse" : undefined} />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem onSelect={retrain.start} disabled={!retrain.canStart} data-testid="retrain-button">
                  <BrainCircuit />
                  {retrain.running ? "Retraining…" : retrain.reachable ? "Retrain the model" : "Retrain (Airflow not reachable)"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={askReset} disabled={rated === 0} data-testid="reset-ratings-button">
                  <Eraser />
                  Reset all ratings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {resetDialog}
            {retrain.confirmDialog}
          </div>
        </div>
        {/* How far the rating has got, as a bar, with its count at the
            end. It was "323.4 nm · 328°T" and "56 of 269 rated · 6
            hidden by the filters" in words: the route's distance and
            heading are the nav log's, not the rating's, and the filters'
            sheet counts what each one holds back. */}
        <div className="flex items-center gap-3 py-1">
          <Progress
            value={total ? (rated / total) * 100 : 0} className="flex-1"
            aria-label={`${rated} of ${total} rated`} data-testid="rated-progress"
          />
          <span className={cn("shrink-0 text-muted-foreground tabular-nums", TEXT.note)} aria-hidden>{rated} of {total}</span>
        </div>
      </div>
      {/* data-waypoint-list marks the scope TrainWorkspace's keyboard handler
          checks to tell "arrows should walk this list" apart from
          "arrows should walk the map" -- set once focus lands inside
          here (a row is focusable), not on hover, so it survives
          scrolling. The left inset for a phone on its side, whose notch
          is at the drawer's edge. */}
      <div
        className="min-h-0 flex-1 overflow-auto pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)]"
        data-waypoint-list data-testid="waypoint-scroller"
      >
        <ul aria-label={`Waypoints from ${departureIdent} to ${destinationIdent}`} className="divide-y divide-border">
          {entries.length === 0 && <li className={cn("px-3 py-3 text-muted-foreground", TEXT.prose)}>No waypoints yet</li>}
          {entries.map(entry => {
            const p = entry.point;
            const isSelected = p === selected;
            const key = `${entry.kind}-${pointKey(p)}`;
            if (isEndpoint(p)) {
              return (
                <li key={key}>
                  <WaypointRow
                    selected={isSelected} onSelect={() => onFocus(entry)} rowRef={isSelected ? selectedRef : undefined}
                    title={p.ident}
                    detail={`${p.category === "departure" ? "Departure" : "Destination"} · ${p.name}`}
                  />
                </li>
              );
            }
            const rating = (p as { rating: Rating | null }).rating;
            const cross = (p as { cross_track_nm?: number }).cross_track_nm ?? 0;
            // DR points are on the line by definition; how far off it only
            // means something for a visual point, picked because it sits
            // off it.
            const detail = [
              `${p.along_track_nm.toFixed(1)} nm out`,
              roleOf(p) === "visual" && `visual, ${Math.abs(cross).toFixed(1)} nm off course`,
              sourceOf(p) === "added" && "added by hand",
            ].filter(Boolean).join(" · ");
            return (
              <li key={key}>
                <WaypointRow
                  number={numbers.get(entry)} expands
                  selected={isSelected} onSelect={() => onFocus(entry)} rowRef={isSelected ? selectedRef : undefined}
                  title={capitalised(prettyCategory((p as { category: string }).category))}
                  detail={detail}
                  end={rating === null
                    ? <span className="text-muted-foreground" aria-label="Not rated">—</span>
                    : <Badge style={{ backgroundColor: COLORS[rating], color: inkOn(COLORS[rating]) }}>{rating}</Badge>}
                />
                {/* The selected waypoint's own rating buttons, under it
                    -- the same six the map popup has, and the digit keys'
                    own scale, with what its ends mean. Rating from here
                    moves on to the next row (TrainWorkspace's onRate), the
                    way the keys do, so a corridor rates top to bottom. */}
                {isSelected && (
                  <div className="bg-foreground/8 pt-1.5 pr-1 pb-2.5 pl-3">
                    {/* Six of 36 by 32, eight apart side by side and twelve
                        between rows: each reaches 44 points through its own
                        hit area (index.css), which starts at the row above's
                        edge, without reaching into the next one's -- these
                        are tapped a few hundred times a route. In line under
                        the title, and on one row on a phone at the default
                        text size (the strip's right padding given up for
                        it); set larger, they wrap. */}
                    <div className="flex flex-wrap gap-x-2 gap-y-3 pl-10" role="group" aria-label="Rate this waypoint">
                      {RATINGS.map(r => (
                        <Button
                          key={r} type="button" size="sm"
                          onClick={() => onRate(r)}
                          aria-label={`Rate ${r}`} aria-pressed={rating === r}
                          className={cn("w-9 px-0 font-bold", rating === r && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}
                          style={{ backgroundColor: COLORS[r], color: inkOn(COLORS[r]) }}
                        >
                          {r}
                        </Button>
                      ))}
                    </div>
                    {/* Two pixels clear of the buttons' hit areas, which reach
                        six below them; the tint's own grey words, as the
                        row's. */}
                    <p className={cn("mt-2 pr-2 pl-10 text-foreground/70", TEXT.note)}>{SCALE_KEY}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** "Road or rail" for "road or rail": a row's kind as its title. */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One row of the walk: its number (the map popup's), what it is and,
 * under that, where; at the end its rating. The whole row is the
 * button, as an iOS list row is: a tap selects it and the map goes to
 * it, and a selected detection opens its rating buttons under it (said
 * to a reader as aria-expanded).
 */
function WaypointRow({ number, title, detail, end, selected, expands = false, onSelect, rowRef }: {
  number?: number;
  title: string;
  detail: string;
  end?: ReactNode;
  selected: boolean;
  expands?: boolean;
  onSelect: () => void;
  rowRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={rowRef} type="button" onClick={onSelect}
      data-waypoint-row data-selected={selected || undefined} aria-expanded={expands ? selected : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        // The selection a grey tint, as an iOS list's is -- the stock
        // accent is a shade off the drawer's own background, too faint
        // to find the row the rating buttons belong to.
        "hover:bg-foreground/5 active:bg-foreground/8",
        selected && "bg-foreground/8 hover:bg-foreground/8",
      )}
    >
      {/* A list row's sizes (TEXT), as every list's are. The grey words
          darker on the selection's tint: muted on it was 3.9:1, under
          WCAG's 4.5. */}
      <span className={cn("w-7 shrink-0 text-right tabular-nums", TEXT.detail, selected ? "text-foreground/70" : "text-muted-foreground")}>
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block leading-snug", TEXT.row)}>{title}</span>
        <span className={cn("block leading-snug", TEXT.detail, selected ? "text-foreground/70" : "text-muted-foreground")}>{detail}</span>
      </span>
      {end && <span className={cn("shrink-0 tabular-nums", TEXT.detail)}>{end}</span>}
    </button>
  );
}
