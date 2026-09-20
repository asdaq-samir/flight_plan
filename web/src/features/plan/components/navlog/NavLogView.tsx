import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import clsx from "clsx";
import { BookOpenText, Loader2, Minimize2, WandSparkles } from "lucide-react";
import {
  type CellData, type ColumnDef, type RowData, type TableFeatures,
  flexRender, tableFeatures, useTable,
} from "@tanstack/react-table";
import IconButton from "../../../../components/IconButton";
import { Input } from "../../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../../../components/ui/table";
import type { Candidate, Leg, NavLog, Totals } from "../../../../lib/api/types";
import { type Description, descriptionKey } from "../../hooks/usePlanState";
import { altFt, deg, one, signed, totalsParts } from "../../format";

// TanStack Table's own extension point for arbitrary per-column data --
// used below to carry each numeric column's shared className (bordered,
// right-aligned) instead of repeating it on every column definition's
// own `cell`/`header`, the same way `meta` is meant to be used.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match the real ColumnMeta's own type params for the module augmentation to merge
  interface ColumnMeta<TFeatures extends TableFeatures, TData extends RowData, TValue extends CellData = CellData> {
    className?: string;
  }
}

// No sorting/filtering/pagination/selection/visibility -- a nav log's
// own row order IS its meaning (waypoints in the order a pilot
// actually flies them), so this table opts into none of TanStack
// Table's v9 feature modules; `tableFeatures({})` is its own
// documented way to say "just the core row/column/header model," not
// a placeholder waiting to be filled in.
const navLogTableFeatures = tableFeatures({});

/** One row of the nav log's own data -- the departure, every scored
 *  checkpoint, and the destination all end up here in this same shape
 *  (unified from three previously-separate cases) since every numeric
 *  column already reduces to "—" whenever `leg` is undefined, which is
 *  true for the departure row the same way it's true for a checkpoint
 *  whose own leg hasn't streamed in yet -- the one column that
 *  genuinely needs to know it's the departure specifically is Alt,
 *  handled in that column's own `cell` below. */
interface WaypointRow {
  key: string;
  isDeparture: boolean;
  cp: Candidate | null;
  name: string;
  lat: number;
  lon: number;
  leg: Leg | undefined;
}

interface Props {
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  /** The pilot's own cruise-altitude override -- lives here, not the
   *  map header's route form, since this is where the *result*
   *  (`nav.altitude_ft`/`nav.altitude_selection`) already shows: typing
   *  a new one and seeing what it changes is one place, not two. Wired
   *  to the same `onSubmit` PlanView's own "Load" button calls, so
   *  Enter here re-plans the exact same way that button does. */
  alt: string;
  onAltChange: (v: string) => void;
  onSubmit: () => void;
  /** The aeroplane the log is computed for -- a stock profile or one of
   *  the pilot's own -- chosen here, where its numbers (TAS, fuel burn)
   *  show up. Value/label pairs, the current value, and a change handler
   *  that re-plans. */
  aircraftValue: string;
  aircraftOptions: { value: string; label: string }[];
  onAircraftChange: (value: string) => void;
  /** Streamed in one at a time, in the same order as `selected` --
   *  `legs[i]` is the leg that arrives at `selected[i]`, one short of
   *  `selected.length + 1` until the final leg (to the destination)
   *  streams in. A row is drawn for every waypoint in `selected` and
   *  the destination regardless of how many legs have arrived yet --
   *  the ones without a leg show placeholders rather than waiting. */
  legs: Leg[];
  dep: string;
  dest: string;
  /** The airport's own full name (e.g. "Osceola Municipal"), not the
   *  ident already shown in the Waypoint column -- shown as a plain
   *  line under each, the same spot a checkpoint's own description
   *  sits, but never editable or AI-generated: there's no "how to
   *  spot it" for an airport, and no LLM service behind this one, just
   *  a fact the course response already carries. null before a course
   *  has loaded. */
  depName: string | null;
  destName: string | null;
  depLat: number;
  depLon: number;
  destLat: number;
  destLon: number;
  /** In the same order as `legs` -- the checkpoint leg `i` arrives at
   *  is `selected[i]`, matching how PlanView already builds the leg
   *  list itself (fixes = [departure, ...selected, destination]). */
  selected: Candidate[];
  /** Field elevation at each end -- the altitude column's own first
   *  and last rows, since the aircraft starts and lands there rather
   *  than at the one constant cruise altitude every checkpoint in
   *  between flies at. null when OurAirports has no recorded
   *  elevation for that airport. */
  depElevationFt: number | null;
  destElevationFt: number | null;
  descriptions: Record<string, Description>;
  onSaveDescription: (lat: number, lon: number, text: string) => void;
  /** The AI button's own one-shot "generate now" for every
   *  checkpoint's description at once -- descriptions are visible
   *  (and editable) in every row regardless of whether this has ever
   *  been clicked. */
  onGenerateDescriptions: () => void;
  descriptionsLoading: boolean;
  /** Whether the drawer is open wide as the briefing -- this same
   *  table with the briefing's sections under it (`children`) and the
   *  briefing's own actions in this header (`actions`), wide enough for
   *  every column without a horizontal scroll. The toggle lives here
   *  (not floating over the map) since it's this content's own width
   *  it changes; Shell reads the same `expanded` value to size the
   *  drawer itself. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** The briefing's own header actions (the narrative popover, Print)
   *  -- present only while `expanded`. */
  actions?: ReactNode;
  /** The briefing's sections, rendered under the table in the same
   *  scroller -- present only while `expanded`. */
  children?: ReactNode;
  /** Clicking a row focuses that waypoint on the map (pans/zooms to
   *  it, draws the halo) the same way clicking its marker there
   *  selects this row -- keyed by coordinates rather than a row
   *  index, since the map's own marker order and this table's order
   *  are two independent views of the same points. Null while
   *  nothing is selected. */
  selectedPoint: { lat: number; lon: number } | null;
  onSelectPoint: (lat: number, lon: number) => void;
}

/**
 * One checkpoint's "how to spot it" text -- an editable box from the
 * start, whether or not the AI button has ever been clicked for this
 * route: a pilot can type their own note here without asking for a
 * generated one first. Clicking the AI button just streams a value
 * into it later, the same as a pilot's own edit would, and this cell
 * doesn't care which one filled it in. Local draft state is what lets
 * typing feel immediate without saving on every keystroke; the save
 * itself happens on blur.
 */
function DescriptionCell({
  description, onSave, selected, onFocus,
}: {
  description: Description | undefined;
  onSave: (text: string) => void;
  /** Inverted the same way its own waypoint row is -- the two read as
   *  one selected group rather than a highlighted row sitting above
   *  an unrelated one. */
  selected: boolean;
  /** Selects this row's own waypoint the moment a pilot focuses (or
   *  clicks into) the box -- the reverse half of the sync: selecting
   *  the row already highlights this box, and typing here should
   *  highlight the row back, not leave it looking unselected while
   *  its own description is what's actually being edited. */
  onFocus: () => void;
}) {
  const [draft, setDraft] = useState(description?.text ?? "");
  // A fresh arrival from the stream (or someone else's edit) should
  // overwrite an untouched draft -- but not fight typing in progress,
  // which is why this only resets when the underlying text itself
  // changes. Compared and reset during render, not in a useEffect: an
  // effect only runs after the stale draft has already committed and
  // painted, which is a visible one-frame flash of the old text every
  // time a fresh description arrives; this react-hooks-docs-recommended
  // "adjust state while rendering" pattern applies the reset before
  // that first paint instead.
  const [lastSeenText, setLastSeenText] = useState(description?.text);
  if (description?.text !== lastSeenText) {
    setLastSeenText(description?.text);
    setDraft(description?.text ?? "");
  }

  return (
    <textarea
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== (description?.text ?? "")) onSave(trimmed);
      }}
      rows={1}
      placeholder={description?.source === "error" ? "Couldn't auto-generate — type one" : "How to spot it…"}
      // text-base below md, like the stock Input: iOS Safari zooms the
      // whole page in on focusing any field under 16px, and stays
      // zoomed after the drawer closes -- the header and the route
      // form off the top of the screen. The same 16px floor on a phone
      // that shadcn's own Input keeps, for the same reason.
      className={clsx(
        "w-full resize-none rounded border py-0.5 pr-1 pl-0.5 text-left align-top text-base focus:outline-none md:text-xs",
        // The box itself stays light even when its row is selected --
        // only the surrounding row inverts, so this reads as an
        // editable field sitting on a highlighted row, not one more
        // dark surface swallowing the text.
        selected
          ? "border-foreground bg-background text-foreground"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border focus:border-ring focus:bg-background",
      )}
    />
  );
}

/**
 * A clickable/keyboard-selectable waypoint row -- the departure row and
 * every checkpoint/destination row all select the same way (click,
 * Enter, or Space), invert the same way when selected, and only differ
 * in whether they're muted while *not* selected (the destination and
 * checkpoints missing wind data are; the departure and a checkpoint
 * with real wind data aren't). Extracted once both rows had drifted
 * into carrying the exact same onClick/onKeyDown/inversion logic twice.
 */
function SelectableRow({
  selected, mutedWhenUnselected, onSelect, scrollRef, children,
}: {
  selected: boolean;
  mutedWhenUnselected: boolean;
  onSelect: () => void;
  /** Only the actually-selected row needs this -- see NavLogView's own
   *  scrollIntoView effect. */
  scrollRef?: Ref<HTMLTableRowElement>;
  children: React.ReactNode;
}) {
  return (
    <TableRow
      ref={scrollRef}
      onClick={onSelect}
      tabIndex={0}
      data-selected={selected || undefined}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        "cursor-pointer focus:outline-none",
        // Inverted (bg-foreground/text-background), not just a tint --
        // the same treatment shadcn's own Tooltip uses for "this one
        // thing stands apart," which a selected row is exactly. Skips
        // the hover/muted-text classes entirely while selected rather
        // than layering them underneath: both would fight the
        // inversion for the same background/text-color properties.
        selected
          ? "bg-foreground text-background hover:bg-foreground"
          : clsx(mutedWhenUnselected && "text-muted-foreground", "hover:bg-accent focus-visible:bg-accent"),
      )}
    >
      {children}
    </TableRow>
  );
}

/**
 * The plain-text or editable-note row directly under a waypoint row --
 * the airport-name row under departure/destination and the
 * `DescriptionCell` row under a checkpoint are the same shape (a single
 * `colSpan={12}` cell, inverted in step with the row above it), just
 * different content.
 */
function NoteRow({ selected, children }: { selected: boolean; children: React.ReactNode }) {
  return (
    <TableRow className={clsx(selected && "bg-foreground text-background hover:bg-foreground")}>
      <TableCell
        className={clsx("py-1 pr-2 pl-4 text-left text-xs", !selected && "bg-muted/60 text-muted-foreground")}
        colSpan={12}
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

/**
 * The nav log itself -- the planner's own drawer content (in place of
 * a plain checkpoint list), so a pilot can walk the route's real
 * dead-reckoning numbers with the chart still visible beside it. The
 * walk is the point: Up/Down (PlanView's own keys) or a click steps
 * the selection through departure, every checkpoint and the
 * destination, the map follows to whichever is selected, and selecting
 * a point on the map (or another row) scrolls this one into view --
 * the same two-way link the old checkpoint list had.
 *
 * The same table, opened wide, is the briefing: PlanView passes the
 * briefing's sections as `children` and its own actions as `actions`,
 * and this one component is the nav log in both widths -- the briefing
 * used to draw its own read-only copy, and the two drifted.
 *
 * One row per waypoint, not one row per leg with both its ends named
 * on it -- a paper nav log runs down the page checkpoint by checkpoint,
 * each one's row holding the leg it took to get there. The departure
 * is the exception: it opens the log with nothing to its right, since
 * no leg has been flown yet.
 */
export default function NavLogView({
  totals, nav, legs, dep, dest, depName, destName, depLat, depLon, destLat, destLon,
  selected, depElevationFt, destElevationFt, descriptions, onSaveDescription,
  onGenerateDescriptions, descriptionsLoading, expanded, onToggleExpanded, actions, children,
  selectedPoint, onSelectPoint, alt, onAltChange, onSubmit,
  aircraftValue, aircraftOptions, onAircraftChange,
}: Props) {
  const parts = totals ? totalsParts(totals) : null;
  // One row per waypoint the plan already knows about -- every scored
  // checkpoint plus the destination -- regardless of how many of
  // their legs have actually streamed in yet. `undefined` for `leg`
  // is a real, expected state (not yet arrived), not an error.
  const waypoints = [...selected, null].map((cp, i) => ({
    cp,
    name: cp ? (cp.name || cp.category) : dest,
    lat: cp ? cp.lat : destLat,
    lon: cp ? cp.lon : destLon,
    leg: legs[i] as Leg | undefined,
  }));

  // The departure and every waypoint below it, unified into one data
  // array TanStack Table can drive the header/cells from -- see
  // `WaypointRow`'s own comment on why the departure's own special
  // cases collapse into the same shape as everything else. Column
  // defs are declared here, not module scope, since Alt's own header
  // cell is a live form bound to this render's own `alt`/`onAltChange`
  // -- the same reason `nav`/`destElevationFt`/`depElevationFt` are
  // just closed over below rather than threaded through as TanStack's
  // own per-column `meta`.
  const data: WaypointRow[] = [
    ...(selected.length > 0
      ? [{ key: "departure", isDeparture: true, cp: null, name: dep, lat: depLat, lon: depLon, leg: undefined }]
      : []),
    ...waypoints.map(({ cp, name, lat, lon, leg }, i) => ({ key: String(i), isDeparture: false, cp, name, lat, lon, leg })),
  ];
  const columns: ColumnDef<typeof navLogTableFeatures, WaypointRow>[] = [
    {
      id: "waypoint",
      header: "Waypoint",
      cell: ({ row }) => row.original.name,
      meta: { className: "text-left" },
    },
    {
      id: "alt",
      header: () => (
        <form onSubmit={e => { e.preventDefault(); onSubmit(); }}>
          <Input
            value={alt}
            onChange={e => onAltChange(e.target.value)}
            placeholder="Alt"
            spellCheck={false}
            aria-label="Cruise altitude, feet"
            // 16px and tall enough to hold it below md -- see the
            // description box's own comment on iOS zooming on focus.
            className="h-8 w-14 px-1 text-right text-base print:hidden md:h-6 md:text-xs"
          />
          <span className="hidden print:inline">Alt</span>
        </form>
      ),
      // The last row lands at the destination -- shows its field
      // elevation, known immediately, rather than the cruise altitude
      // every checkpoint before it flies at (which isn't known until
      // the "altitude" message arrives, either -- hence `nav?.`).
      cell: ({ row }) => {
        const { isDeparture, cp } = row.original;
        return altFt(isDeparture ? depElevationFt : (cp ? nav?.altitude_ft : destElevationFt));
      },
    },
    {
      id: "dist",
      header: "Dist",
      cell: ({ row }) => (row.original.leg ? row.original.leg.distance_nm.toFixed(1) : "—"),
    },
    {
      id: "tc",
      header: "TC",
      cell: ({ row }) => (row.original.leg ? deg(row.original.leg.true_course_deg) : "—"),
    },
    {
      id: "wind",
      header: "Wind",
      cell: ({ row }) => {
        const { leg } = row.original;
        return leg ? (leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data") : "—";
      },
    },
    {
      id: "wca",
      header: "WCA",
      cell: ({ row }) => (row.original.leg ? signed(row.original.leg.wca_deg) : "—"),
    },
    {
      id: "th",
      header: "TH",
      cell: ({ row }) => (row.original.leg ? deg(row.original.leg.true_heading_deg) : "—"),
    },
    {
      id: "var",
      header: "Var",
      cell: ({ row }) => (row.original.leg ? signed(row.original.leg.magnetic_variation_deg) : "—"),
    },
    {
      id: "mh",
      header: "MH",
      cell: ({ row }) => (row.original.leg ? deg(row.original.leg.magnetic_heading_deg) : "—"),
    },
    {
      id: "gs",
      header: "GS",
      cell: ({ row }) => {
        const { leg } = row.original;
        return leg ? (leg.groundspeed_kt === null ? "—" : Math.round(leg.groundspeed_kt)) : "—";
      },
    },
    {
      id: "ete",
      header: "ETE",
      cell: ({ row }) => {
        const { leg } = row.original;
        return leg ? (leg.ete_min === null ? "unflyable" : one(leg.ete_min)) : "—";
      },
    },
    {
      id: "fuel",
      header: "Fuel",
      cell: ({ row }) => (row.original.leg ? one(row.original.leg.fuel_gal) : "—"),
    },
  ];
  // No sorting/filtering/pagination -- a nav log's own row order IS
  // its meaning (waypoints in the order a pilot actually flies them),
  // and `navLogTableFeatures`'s own core model is the only row model
  // this needs; a sortable column here would let a pilot reorder the
  // log into something unflyable (e.g. by Fuel).
  const table = useTable({ features: navLogTableFeatures, data, columns, getRowId: row => row.key });

  const selectedRef = useRef<HTMLTableRowElement>(null);
  // Selecting a point on the map should be as visible here as
  // clicking the row itself would have been -- otherwise the
  // highlighted row can be scrolled out of view in this (now often
  // narrow, since it's a draggable sidebar) column and looks like
  // nothing happened.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedPoint]);

  const isSelected = (lat: number, lon: number) =>
    !!selectedPoint && descriptionKey(lat, lon) === descriptionKey(selectedPoint.lat, selectedPoint.lon);

  return (
    // print:h-auto print:overflow-visible: on screen this fills a fixed
    // viewport height and clips to it, deliberately -- on paper there
    // is no viewport to clip to, and a route long enough to scroll
    // would otherwise print only whatever page's worth happened to be
    // visible.
    <div className="flex h-full flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
      {/* Printed, this header is the briefing's title: the page's own
          header (the route form) is print:hidden, so the route is
          named here instead, and the buttons drop out. */}
      <div className="flex flex-col gap-1 border-b border-border p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-muted-foreground">{expanded ? "Flight briefing" : "Nav log"}</span>
          <span className="hidden text-muted-foreground print:inline">{dep} → {dest}</span>
          <div className="ml-auto flex items-center gap-1 print:hidden">
            {/* A wand, not the narrative's own sparkles: with the
                briefing open the two AI buttons sit side by side, and
                this one acts on the rows -- it fills the blank notes
                in -- where the narrative writes a text of its own. */}
            <IconButton
              onClick={onGenerateDescriptions} disabled={descriptionsLoading || selected.length === 0}
              label="Generate checkpoint descriptions"
              data-testid="generate-descriptions-button"
            >
              {descriptionsLoading ? <Loader2 className="size-5 animate-spin" /> : <WandSparkles className="size-5" />}
            </IconButton>
            {actions}
            {/* Wide is the briefing, narrow is the nav log beside the
                map -- on a phone too, where wide means the whole map
                area rather than three quarters of it. An open book to
                open the briefing (the document a pilot is looking for,
                not "make this bigger"), and the shrink arrows to come
                back, which is all that step is. */}
            <IconButton
              onClick={onToggleExpanded}
              label={expanded ? "Back to the nav log" : "Open the briefing"}
              data-testid="sidebar-expand-toggle"
            >
              {expanded ? <Minimize2 className="size-5" /> : <BookOpenText className="size-5" />}
            </IconButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:ml-0">
          {parts && (
            <span>
              <b>{parts.distance}</b> · <b>{parts.time}</b> · <b>{parts.fuel}</b>
              {parts.warning && <> · <span className="text-destructive">{parts.warning}</span></>}
            </span>
          )}
          {nav && (
            <span className="text-muted-foreground">
              {nav.altitude_ft} ft{" "}
              {nav.altitude_selection ? `(auto: floor ${nav.altitude_selection.floor_ft} ft)` : "(you set this)"}
            </span>
          )}
          <Select value={aircraftValue} onValueChange={onAircraftChange}>
            <SelectTrigger size="sm" aria-label="Aircraft" className="print:hidden" data-testid="aircraft-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {aircraftOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="hidden text-muted-foreground print:inline">
            {aircraftOptions.find(o => o.value === aircraftValue)?.label}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 print:h-auto print:overflow-visible" data-testid="navlog-scroller">
        {/* Narrow, the whole scroller scrolls sideways as one; wide,
            with the briefing's sections under it, the table scrolls
            inside its own container on a phone so the sections below
            stay put. Printed, nothing scrolls: every column is laid out
            for the browser to paginate. */}
        <Table
          containerClassName={children ? "overflow-x-auto print:overflow-visible" : "overflow-visible"}
          className="text-right text-xs whitespace-nowrap"
        >
          <TableCaption className="sr-only">
            Navigation log from {dep} to {dest}
          </TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <TableHead
                    key={header.id}
                    // font-normal only for Alt -- it holds a live
                    // input, not a label, so the bold weight every
                    // other header (a plain column name) keeps
                    // doesn't belong on it.
                    className={clsx(
                      header.column.id === "alt" && "font-normal",
                      header.column.columnDef.meta?.className,
                    )}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {selected.length === 0 && (
              <TableRow><TableCell className="text-left text-muted-foreground" colSpan={columns.length}>No route planned yet</TableCell></TableRow>
            )}
            {/* One row per waypoint the plan already knows about, not
                one per leg that's actually arrived -- `leg` is
                undefined until its own line streams in, and every cell
                that depends on it shows a dash rather than waiting. The
                departure (when present) is `table`'s own first row,
                unified with the rest -- see `WaypointRow`'s comment. */}
            {table.getRowModel().rows.map(row => {
              const { isDeparture, cp, lat, lon } = row.original;
              const rowSelected = isSelected(lat, lon);
              const leg = row.original.leg;
              return (
                <Fragment key={row.id}>
                  {/* A leg with no nearby winds-aloft station is a
                      no-wind estimate, not a calm one. Shading keeps
                      that visible rather than letting it read as a
                      confident zero -- the same shade a leg that simply
                      hasn't arrived yet gets, for the same reason: both
                      are "no data (yet)," not a confident answer. The
                      departure is always muted this way instead --
                      it never has wind data of its own to judge. */}
                  <SelectableRow
                    selected={rowSelected}
                    mutedWhenUnselected={isDeparture || !leg?.wind}
                    onSelect={() => onSelectPoint(lat, lon)}
                    scrollRef={rowSelected ? selectedRef : undefined}
                  >
                    {row.getAllCells().map(cell => (
                      <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </SelectableRow>
                  <NoteRow selected={rowSelected}>
                    {isDeparture ? (
                      // The departure airport's own name, not editable
                      // and never AI-generated -- there's no "how to
                      // spot it" for an airport and no LLM service
                      // behind this one, just a fact the course
                      // response already carries. Same slot a
                      // checkpoint's own description sits in, and
                      // inverts the same way when selected, so the
                      // pair still reads as one group.
                      (depName ?? "—")
                    ) : cp ? (
                      <DescriptionCell
                        description={descriptions[descriptionKey(cp.lat, cp.lon)]}
                        onSave={text => onSaveDescription(cp.lat, cp.lon, text)}
                        selected={rowSelected}
                        onFocus={() => onSelectPoint(cp.lat, cp.lon)}
                      />
                    ) : (
                      // The destination airport's own name -- same
                      // plain, non-editable treatment as the
                      // departure's own row above; see NoteRow's own
                      // comment.
                      (destName ?? "—")
                    )}
                  </NoteRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        {/* -mx-2 lines the sections' own cards (CollapsibleSection's
            mx-2) up with the table's edges. */}
        {children && <div className="-mx-2 mt-3">{children}</div>}
      </div>
    </div>
  );
}
