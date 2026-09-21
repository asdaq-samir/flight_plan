import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CircleHelp, Loader2, WandSparkles } from "lucide-react";
import {
  type CellData, type ColumnDef, type RowData, type TableFeatures,
  flexRender, tableFeatures, useTable,
} from "@tanstack/react-table";
import CollapsibleSection from "../../../../components/CollapsibleSection";
import { NoteRow, SelectableRow } from "../../../../components/SelectableRows";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";
import { Textarea } from "../../../../components/ui/textarea";
import AltitudeReasoning from "../AltitudeReasoning";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../../../components/ui/table";
import type { AltitudeChoice, Candidate, Leg, NavLog, Totals } from "../../../../lib/api/types";
import { type Description, descriptionKey } from "../../hooks/usePlanState";
import { altFt, clockTime, deg, describeSteps, describeTime, etaAt, one, signed, totalsParts } from "../../format";
import DepartPicker from "./DepartPicker";

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
  /** The route's true course -- the hemispheric rule in the altitude's
   *  own "why" popover needs it. null before a course has loaded. */
  courseBearingDeg: number | null;
  /** Picks one of the three plans (lowest, highest, fastest) in the
   *  altitude's own popover, which re-plans; which one is flown is the
   *  nav log's own `choice`. */
  onAltitudeChoiceChange: (choice: AltitudeChoice) => void;
  /** The departure time as an ISO instant, or "" for about now --
   *  set here, where its ETAs show; changing it re-plans, since the
   *  winds forecast period follows it. */
  depart: string;
  onDepartChange: (iso: string) => void;
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
  /** The nav log section's own one-shot "generate now" for every
   *  checkpoint's description at once -- descriptions are visible
   *  (and editable) in every row regardless of whether this has ever
   *  been clicked. */
  onGenerateDescriptions: () => void;
  descriptionsLoading: boolean;
  /** The briefing's own header actions (the narrative popover, Print). */
  actions?: ReactNode;
  /** The briefing's sections, rendered under the nav log's own
   *  section in the same scroller. */
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
    <Textarea
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== (description?.text ?? "")) onSave(trimmed);
      }}
      rows={1}
      placeholder={description?.source === "error" ? "Couldn't auto-generate — type one" : "How to spot it…"}
      // shadcn's own Textarea, sized down to a table cell: its 16px on
      // a phone stays (iOS Safari zooms the whole page in on focusing
      // any field under that), the rest is one line in the row.
      className={clsx(
        "min-h-0 w-full resize-none rounded py-0.5 pr-1 pl-0.5 text-left align-top shadow-none md:text-xs",
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
 * The nav log itself -- the planner's own drawer content (in place of
 * a plain checkpoint list), so a pilot can walk the route's real
 * dead-reckoning numbers with the chart still visible beside it. The
 * walk is the point: Up/Down (PlanView's own keys) or a click steps
 * the selection through departure, every checkpoint and the
 * destination, the map follows to whichever is selected, and selecting
 * a point on the map (or another row) scrolls this one into view --
 * the same two-way link the old checkpoint list had.
 *
 * This drawer is the briefing: PlanView passes the briefing's sections
 * as `children` and its own actions as `actions`, and the nav log is
 * the first section of it, with the totals, the altitude and the fuel
 * check above the table. The header holds only the two inputs the log
 * is computed from, the aeroplane and the departure time. The briefing
 * used to draw its own read-only copy of the table, and the two
 * drifted; then the drawer had two widths, the table alone and the
 * whole briefing, which held the same things in two arrangements.
 *
 * One row per waypoint, not one row per leg with both its ends named
 * on it -- a paper nav log runs down the page checkpoint by checkpoint,
 * each one's row holding the leg it took to get there. The departure
 * is the exception: it opens the log with nothing to its right, since
 * no leg has been flown yet.
 */
export default function NavLogView({
  totals, nav, courseBearingDeg, onAltitudeChoiceChange, depart, onDepartChange,
  legs, dep, dest, depName, destName, depLat, depLon, destLat, destLon,
  selected, depElevationFt, destElevationFt, descriptions, onSaveDescription,
  onGenerateDescriptions, descriptionsLoading, actions, children,
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
      // A plain heading: a pilot's own altitude is typed in the
      // altitude popover's Custom row (see the header below), under
      // the three plans, not in this column's head.
      header: "Alt",
      // The last row lands at the destination -- shows its field
      // elevation, known immediately, rather than a cruise altitude.
      // A checkpoint's row shows the altitude of the leg that arrives
      // at it -- a plan may step, so each leg carries its own -- and
      // the plan's first altitude until that leg streams in.
      cell: ({ row }) => {
        const { isDeparture, cp, leg } = row.original;
        return altFt(isDeparture ? depElevationFt : (cp ? (leg?.altitude_ft ?? nav?.altitude_ft) : destElevationFt));
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
  // With a departure time, every row gets its ETA: the departure's
  // own time, then the time each leg ends -- the minutes flown so far,
  // unknown from the first leg that is not in yet or cannot be flown.
  const minutesTo: (number | null)[] = [];
  let flown: number | null = 0;
  for (const leg of legs) {
    flown = flown === null || leg.ete_min === null ? null : flown + leg.ete_min;
    minutesTo.push(flown);
  }
  const etaColumn: ColumnDef<typeof navLogTableFeatures, WaypointRow> = {
    id: "eta",
    header: "ETA",
    cell: ({ row }) => {
      const { isDeparture, key } = row.original;
      if (isDeparture) return clockTime(new Date(depart));
      return etaAt(depart, minutesTo[Number(key)] ?? null);
    },
  };
  if (depart) columns.push(etaColumn);
  // On paper only: the two columns a pilot fills in by hand in flight,
  // the actual time over each fix and the fuel left -- what makes the
  // printed page a nav log to fly with rather than a table to read.
  for (const [id, header] of [["ata", "ATA"], ["fuel_rem", "Fuel rem."]] as const) {
    columns.push({
      id, header,
      cell: () => "",
      meta: { className: "hidden w-14 border-l border-border print:table-cell" },
    });
  }
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

  // The table itself. With the briefing's sections under it, the table
  // scrolls sideways inside its own container so the sections below
  // stay put. Printed, nothing scrolls: every column is laid out for
  // the browser to paginate.
  const navLogTable = (
    <Table
      containerClassName="overflow-x-auto print:overflow-visible"
      className="text-right text-xs whitespace-nowrap"
    >
      <TableCaption className="sr-only">
        Navigation log from {dep} to {dest}
      </TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map(headerGroup => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map(header => (
              <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
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
              <NoteRow selected={rowSelected} colSpan={columns.length}>
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
  );

  // What the log adds up to, and the one action on its rows: the
  // totals, the altitude and why, the winds period, the fuel check,
  // and the button that fills the blank notes in. The first thing in
  // the nav log's own section, above the table, so the header above
  // holds only what the log is computed from.
  const summary = (
    <div className="mb-3 flex flex-col gap-1 text-sm" data-testid="navlog-summary">
      <div className="flex flex-wrap items-center gap-2">
        {parts && (
          <span>
            <b>{parts.distance}</b> · <b>{parts.time}</b> · <b>{parts.fuel}</b>
            {depart && totals && totals.ete_min !== null && <> · ETA <b>{etaAt(depart, totals.ete_min)}</b></>}
            {parts.warning && <> · <span className="text-destructive">{parts.warning}</span></>}
          </span>
        )}
        {/* The altitude, and why: a pilot should never have to take a
            cruise altitude on trust, so the figure itself opens the
            planner's own reasoning -- floor, ceiling, the rule, the
            weather checked -- rather than a bare "(auto)". Printed,
            the plain figure; the briefing's Cruise Altitude section
            carries the same steps onto the paper. */}
        {nav && (() => {
          // "2,500 ft · lowest", or "2,500–6,500 ft · fastest" for a
          // plan that steps; "· yours" for a typed altitude.
          const flown = nav.options.find(o => o.kind === nav.choice);
          const altitudes = flown ? flown.steps.map(st => st.altitude_ft) : [nav.altitude_ft];
          const range = altitudes.length > 1 && Math.min(...altitudes) !== Math.max(...altitudes)
            ? `${altFt(Math.min(...altitudes))}–${altFt(Math.max(...altitudes))} ft`
            : `${altFt(altitudes[0])} ft`;
          // `choice` is null for a typed altitude: the plans are still
          // offered beside it, but none is being flown.
          const label = `${range} · ${nav.choice ?? "yours"}`;
          return (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost" size="sm" className="px-1.5 font-normal text-muted-foreground print:hidden"
                    aria-label="How the altitude was chosen" data-testid="altitude-why"
                  >
                    {label}
                    <CircleHelp className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="max-h-[70vh] w-80 overflow-y-auto">
                  {/* The three plans first, each a button: the pilot
                      picks one and the log re-plans on it. Then why. */}
                  <div className="mb-3 space-y-1.5" role="group" aria-label="Cruise altitude plans">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Three plans, or your own</div>
                    {nav.options.map(o => (
                      <Button
                        key={o.kind} type="button" size="sm"
                        variant={o.kind === nav.choice ? "default" : "outline"}
                        aria-pressed={o.kind === nav.choice}
                        className="h-auto w-full justify-between gap-3 whitespace-normal py-1.5 text-left"
                        onClick={() => onAltitudeChoiceChange(o.kind)}
                        data-testid={`altitude-plan-${o.kind}`}
                      >
                        <span>
                          <span className="font-semibold capitalize">{o.kind}</span>
                          <span className="block text-xs font-normal opacity-80">{describeSteps(o)}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums">{describeTime(o)}</span>
                      </Button>
                    ))}
                    {/* The pilot's own altitude, one number for the
                        whole route: a fourth row under the three
                        plans, pressed while it is what the log flies.
                        Enter or Fly re-plans at it; the stock Input's
                        16px below md keeps a phone from zooming. */}
                    <form
                      className={clsx(
                        "flex items-center gap-2 rounded-md border px-2 py-1.5",
                        nav.choice === null ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                      onSubmit={e => { e.preventDefault(); onSubmit(); }}
                      aria-label="Custom altitude"
                    >
                      <span className="text-sm font-semibold">Custom</span>
                      <Input
                        value={alt}
                        onChange={e => onAltChange(e.target.value)}
                        placeholder="ft"
                        inputMode="numeric"
                        spellCheck={false}
                        aria-label="Cruise altitude, feet"
                        className="ml-auto h-8 w-24 bg-background text-right text-foreground"
                        data-testid="custom-altitude"
                      />
                      <Button
                        type="submit" size="sm" variant={nav.choice === null ? "secondary" : "outline"}
                        disabled={!alt.trim()} data-testid="custom-altitude-fly"
                      >
                        Fly
                      </Button>
                    </form>
                  </div>
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">How the altitude was chosen</div>
                  <AltitudeReasoning nav={nav} bearingDeg={courseBearingDeg} />
                </PopoverContent>
              </Popover>
              <span className="hidden text-muted-foreground print:inline">
                {label}
              </span>
            </>
          );
        })()}
        {/* Which winds forecast period the legs are flown on -- named
            so a pilot knows the winds are the 12-hour forecast, say,
            not now's. Only with a departure time: without one the
            legs are flown on the nearest period to now. */}
        {depart && (
          <span className="text-xs text-muted-foreground" data-testid="winds-forecast">
            winds: {nav ? `${Number(nav.winds_forecast_hr)}-hour forecast` : "…"}
          </span>
        )}
        {/* A wand, not the narrative's own sparkles: this one acts on
            the rows -- it fills the blank notes in -- where the
            narrative in the header writes a text of its own. */}
        <Button
          variant="outline" size="sm" className="ml-auto print:hidden"
          onClick={onGenerateDescriptions} disabled={descriptionsLoading || selected.length === 0}
          data-testid="generate-descriptions-button"
        >
          {descriptionsLoading ? <Loader2 className="animate-spin" /> : <WandSparkles />}
          Generate descriptions
        </Button>
      </div>
      {/* The fuel check (14 CFR 91.151): the legs' fuel plus the
          reserve -- 30 minutes by day, 45 at night, the day one
          assumed and said so without a departure time -- against the
          aeroplane's usable fuel when it has one, red when the tanks
          do not hold it. */}
      {totals && totals.fuel_required_gal != null && (
        <div
          className={clsx(
            "text-xs",
            totals.fuel_margin_gal != null && totals.fuel_margin_gal < 0
              ? "font-semibold text-destructive"
              : "text-muted-foreground",
          )}
          data-testid="fuel-check"
        >
          Fuel required {one(totals.fuel_required_gal)} gal
          {` (${totals.reserve_min} min ${totals.night == null ? "day reserve, no departure time" : totals.night ? "night reserve" : "day reserve"})`}
          {totals.usable_fuel_gal != null && ` of ${totals.usable_fuel_gal} usable`}
          {totals.fuel_margin_gal != null && totals.fuel_margin_gal < 0 && ` · short by ${one(-totals.fuel_margin_gal)} gal`}
        </div>
      )}
    </div>
  );

  return (
    // print:h-auto print:overflow-visible: on screen this fills a fixed
    // viewport height and clips to it, deliberately -- on paper there
    // is no viewport to clip to, and a route long enough to scroll
    // would otherwise print only whatever page's worth happened to be
    // visible.
    <div className="flex h-full flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
      {/* Printed, this header is the briefing's title: the page's own
          header (the route form) is print:hidden, so the route is
          named here instead, the inputs become a line of text, and
          the buttons drop out. */}
      <div className="flex flex-col gap-2 border-b border-border p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-muted-foreground" data-testid="drawer-title">Flight Planning</span>
          <span className="hidden text-muted-foreground print:inline">{dep} → {dest}</span>
          <div className="ml-auto flex items-center gap-1 print:hidden">{actions}</div>
        </div>
        {/* The two inputs the log is computed from, and nothing else
            of it: the aeroplane (a stock profile or one of the pilot's
            own; its TAS and burn are what the legs' times and fuel
            come from) and when the flight leaves, which gives every
            row an ETA, is what a saved flight is planned for, and
            picks the winds forecast period; shadcn's date picker with
            a time box (DepartPicker), empty for about now. */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Select value={aircraftValue} onValueChange={onAircraftChange}>
            <SelectTrigger size="sm" aria-label="Aircraft" data-testid="aircraft-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {aircraftOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <DepartPicker value={depart} onChange={onDepartChange} />
        </div>
        <div className="hidden text-muted-foreground print:block">
          {aircraftOptions.find(o => o.value === aircraftValue)?.label}
          {depart && ` · departing ${new Date(depart).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${clockTime(new Date(depart))}`}
        </div>
      </div>
      {/* Every section starts closed, the nav log's own included: the
          drawer opens as the list of what the briefing holds, and a
          pilot opens what they want on its title, rather than landing
          in twenty rows of numbers with the weather somewhere below.
          Inside the nav log's section, the summary, then the table.
          `flight-briefing`: index.css's print rules show every closed
          section under it on paper, so the whole briefing prints
          whatever is open. -mx-2 lines the sections' own cards
          (CollapsibleSection's mx-2) up with the drawer's padding. */}
      <div
        className="flight-briefing min-h-0 flex-1 overflow-auto p-3 print:h-auto print:overflow-visible"
        data-testid="navlog-scroller"
      >
        <div className="-mx-2">
          <CollapsibleSection title="Nav log">
            {summary}
            {navLogTable}
          </CollapsibleSection>
          {children}
        </div>
      </div>
    </div>
  );
}
