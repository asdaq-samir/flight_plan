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
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import {
  COLORS, modelNote, pointKey, prettyCategory, roleOf, sourceOf, type FilterKey, type Filters, type WalkEntry,
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
  departureIdent: string;
  destinationIdent: string;
}

interface ActionProps {
  /** How many points are rated: Reset all has nothing to do at none. */
  rated: number;
  filters: Filters;
  counts: Record<FilterKey, number>;
  onFilterChange: (key: FilterKey, on: boolean) => void;
  canUndo: boolean;
  onUndo: () => void;
  onResetAll: () => void;
}

/**
 * The developer's waypoint panel: the walk as one list, stepped with
 * Up/Down or a tap, the map following. It is a worklist, not a record:
 * every candidate the filters admit is a row, the unrated ones
 * included, numbered the way the map popup numbers them, with the
 * rating (or a dash) at the end -- the old list showed only what was
 * already rated, which left the actual job, the unrated ones, on the
 * map alone. A tap puts a row's point in the rating card over the list
 * (RatingCard, under the route at the owner's pick of the dev page's
 * redesign), where the six ratings are: they were under the selected row,
 * which the panel's pill could not show.
 *
 * A list as iOS draws one, where it was a table of 12-point columns: a
 * row each, its kind at 17 points and where it is under that at 15 (14
 * and 12 with a mouse: the app's sizes, TEXT), 44 points and more to tap, the
 * selection a tint rather than a black bar. Its actions are beside the
 * route (WaypointActions), and how far the rating has got is the panel's
 * figures at its foot (TrainWorkspace's FigureStrip).
 */
export default function WaypointPanel({
  entries, selected, onFocus, departureIdent, destinationIdent,
}: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null);
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
      {/* Said on the panel's tab; here for a screen reader. */}
      <span className="sr-only" data-testid="drawer-title">Model Training</span>
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
          {entries.length === 0 && <li role="status" className={cn("px-4 py-3 text-muted-foreground", TEXT.prose)}>No waypoints yet</li>}
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
              // What the chart model makes of it, beside where it is: in
              // the line under, not the rating's place at the end, as it
              // is not a rating.
              modelNote(p),
            ].filter(Boolean).join(" · ");
            return (
              <li key={key}>
                <WaypointRow
                  number={numbers.get(entry)}
                  selected={isSelected} onSelect={() => onFocus(entry)} rowRef={isSelected ? selectedRef : undefined}
                  title={capitalised(prettyCategory((p as { category: string }).category))}
                  detail={detail}
                  end={rating === null
                    ? <span aria-label="Not rated">—</span>
                    : <Badge style={{ backgroundColor: COLORS[rating], color: inkOn(COLORS[rating]) }}>{rating}</Badge>}
                />
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
 * it, and puts it in the rating card over the list (RatingCard).
 */
function WaypointRow({ number, title, detail, end, selected, onSelect, rowRef }: {
  number?: number;
  title: string;
  detail: string;
  end?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  rowRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={rowRef} type="button" onClick={onSelect}
      data-waypoint-row data-selected={selected || undefined}
      className={cn(
        // The drawer's margin, 16, as every sheet's: it was 12.
        "flex w-full items-center gap-3 px-4 py-2 text-left outline-none",
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
      {end && <span className={cn("shrink-0 tabular-nums", TEXT.detail, selected ? "text-foreground/70" : "text-muted-foreground")}>{end}</span>}
    </button>
  );
}

/**
 * The training panel's actions, beside the route (MapPage): toolbar
 * buttons, a word under each icon as the planner's are -- Filter and
 * Undo, used all through a walk, and More, which holds what is done
 * once: Retrain, and Reset all ratings in red at the bottom, away from
 * Undo, where it sat beside it as a red eraser. The filters live in a
 * sheet so the list has the height.
 */
export function WaypointActions({ rated, filters, counts, onFilterChange, canUndo, onUndo, onResetAll }: ActionProps) {
  // The filters' sheet, closed from its own Done as well as by a tap
  // outside it.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Retrain from here, in More with Reset: the ratings this panel
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
  return (
    <>
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
            {retrain.running ? "Retraining…" : !retrain.reachable ? "Retrain (Airflow not reachable)"
              : retrain.training && !retrain.training.ready ? `Retrain (${retrain.training.usable} of ${retrain.training.needed} ratings)` : "Retrain the model"}
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
    </>
  );
}
