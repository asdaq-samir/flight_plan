import { Fragment, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { cn } from "cn";
import { CloudSun, Gauge, ListOrdered, Loader2, Sparkles, TowerControl, WandSparkles } from "lucide-react";
import {
  type CellData, type ColumnDef, type RowData, type TableFeatures,
  flexRender, tableFeatures, useTable,
} from "@tanstack/react-table";
import { NoteRow, SelectableRow } from "../../../../components/SelectableRows";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { SectionsOpen } from "../../../../components/sectionLayout";
import { PanelHalfContext } from "../../../../components/mapChrome";
import { LINE_TAB } from "../../../../components/lineTabs";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import IconButton from "../../../../components/IconButton";
import { Textarea } from "../../../../components/ui/textarea";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../../../components/ui/table";
import type { Candidate, Leg, NavLogAltitude, Totals, TopOfClimb, TopOfDescent } from "../../../../lib/api/types";
import { feet } from "../../../../lib/units";
import { routeName } from "../../../../lib/identSchema";
import { revealRow } from "../../../../lib/revealRow";
import { TEXT } from "../../../../lib/text";
import { type Description, descriptionKey } from "../../hooks/useCheckpointNotes";
import { altFt, clockTime, deg, etaAt, one, signed, totalsParts } from "../../format";
import { Spinner } from "../../../../components/ui/spinner";
import type { BriefingPart } from "../briefing/sections";
import { isLegPoint, legOf, navLogRows, rowPoint, type NavLogRow, type RouteEnds } from "./rows";
import LegWorkings from "./LegWorkings";
import DiversionDrill from "./DiversionDrill";
import RouteProfileSection from "./RouteProfileSection";

/** The panel's tabs, in the pilot's order: the Nav Log (the route's
 *  profile under it: the same legs from the side), the Brief, the Weather,
 *  the aeroplane's Performance and the Airports -- each an icon over its
 *  word, as iOS's tab bar draws one, so all five fit a phone's line at any
 *  text size, where six words did not at the pilot's. */
type PanelTab = Exclude<BriefingPart, "profile"> | "navlog";
const TABS: { value: PanelTab; label: string; icon: ReactNode }[] = [
  { value: "navlog", label: "Nav Log", icon: <ListOrdered /> },
  { value: "brief", label: "Brief", icon: <Sparkles /> },
  { value: "weather", label: "Weather", icon: <CloudSun /> },
  { value: "performance", label: "Performance", icon: <Gauge /> },
  { value: "airports", label: "Airports", icon: <TowerControl /> },
];
/** On paper every tab, one after another: the nav log first, as a
 *  pilot flies from it. */
const PRINTED: PanelTab[] = ["navlog", "weather", "airports", "performance", "brief"];

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

interface Props {
  totals: Totals | null;
  nav: NavLogAltitude | null;
  /** The departure time as an ISO instant, or "" for about now --
   *  set here, where its ETAs show; changing it re-plans, since the
   *  winds forecast period follows it. */
  depart: string;
  /** The aeroplane the log is computed for, by name -- chosen in the
   *  panel's controls (FlightInputs), named here on paper. */
  aircraftLabel: string;
  /** Streamed in one at a time, in the same order as `selected` --
   *  `legs[i]` is the leg that arrives at `selected[i]`, one short of
   *  `selected.length + 1` until the final leg (to the destination)
   *  streams in. A row is drawn for every waypoint in `selected` and
   *  the destination regardless of how many legs have arrived yet --
   *  the ones without a leg show placeholders rather than waiting. */
  legs: Leg[];
  dep: string;
  dest: string;
  /** The course's two airports -- where the first and last rows are,
   *  their field elevations (the Alt column's first and last rows: the
   *  aircraft starts and lands there, not at a cruise altitude) and
   *  their full names (shown under each, the same spot a checkpoint's
   *  note sits, never editable). null until the course is known, and
   *  then there are no rows at all. */
  ends: RouteEnds | null;
  /** In the same order as `legs` -- the checkpoint leg `i` arrives at
   *  is `selected[i]`, matching how PlanWorkspace already builds the leg
   *  list itself (fixes = [departure, ...selected, destination]). */
  selected: Candidate[];
  descriptions: Record<string, Description>;
  /** Resolves once the note is saved; the box keeps a pilot's typing
   *  until then, and keeps it if the save fails. */
  onSaveDescription: (lat: number, lon: number, text: string) => Promise<unknown>;
  /** The nav log section's own one-shot "generate now" for every
   *  checkpoint's description at once -- descriptions are visible
   *  (and editable) in every row regardless of whether this has ever
   *  been clicked. */
  onGenerateDescriptions: () => void;
  descriptionsLoading: boolean;
  /** The briefing's sections for each tab but the nav log's own
   *  (FlightBriefingView's parts, and the Brief's narrative). */
  tabContent: (part: BriefingPart) => ReactNode;
  /** Beside the tabs, out of sight: Print's kneeboard card. */
  children?: ReactNode;
  /** Tabs whose part has a warning, a red mark on each. */
  marks?: Partial<Record<PanelTab, boolean>>;
  /** What must be seen on opening the drawer, above every section
   *  (the briefing's warnings). */
  notice?: ReactNode;
  /** The drawer's last line, under every section (the planning-aid
   *  reminder). */
  footer?: ReactNode;
  /** Beside the Nav Log's title, folded or open: a mark that opens to a
   *  note (a tight altitude, no legal altitude: TitleNote). */
  titleNote?: ReactNode;
  /** What is being worked on, with the panel out: said on the section's
   *  line, under its title, in place of the toast over the map. */
  progress?: string | null;
  /** A local flight, one airport to itself: no legs, so the section is
   *  "Local Flight" -- the time aloft, the time back and the fuel, and
   *  the fuel check -- in place of the nav log. */
  local?: boolean;
  /** Clicking a row focuses that waypoint on the map (pans/zooms to
   *  it, draws the halo) the same way clicking its marker there
   *  selects this row -- keyed by coordinates rather than a row
   *  index, since the map's own marker order and this table's order
   *  are two independent views of the same points. Null while
   *  nothing is selected. */
  selectedPoint: { lat: number; lon: number } | null;
  onSelectPoint: (lat: number, lon: number) => void;
  /** Nothing selected: a tap on the selected row, which closes it. */
  onDeselectPoint: () => void;
  /** Whether the drawer holding this is open. The view stays mounted
   *  beside a desktop map whether or not it is. */
  drawerOpen: boolean;
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
export function DescriptionCell({
  description, onSave, selected, onFocus,
}: {
  description: Description | undefined;
  onSave: (text: string) => Promise<unknown>;
  /** Its waypoint's row selected: the box then shows as a field on the
   *  selection's tint, the two reading as one selected group rather
   *  than a highlighted row sitting above an unrelated one. */
  selected: boolean;
  /** Selects this row's own waypoint the moment a pilot focuses (or
   *  clicks into) the box -- the reverse half of the sync: selecting
   *  the row already highlights this box, and typing here should
   *  highlight the row back, not leave it looking unselected while
   *  its own description is what's actually being edited. */
  onFocus: () => void;
}) {
  // null while nobody is editing: the box shows the note as it stands,
  // and a line that streams in shows at once. A string while a pilot
  // types, kept until it is saved -- a generated line arriving in the
  // middle does not replace it, and a save that fails leaves it in the
  // box to try again. It used to be one string reset whenever the note
  // changed, so a line arriving mid-typing replaced the typing, and the
  // blur that followed saw nothing new to save.
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  return (
    // A label round the box, nine points proud of it above and below and
    // taking no room: a tap there focuses the box, so a finger has 44
    // points to find it in while the box itself stays the row's own 26.
    // A text field cannot carry the ::after the buttons reach 44 with
    // (index.css). Positioned, so the band lies over the leg's figures it
    // reaches into rather than under them. The box keeps a name of its
    // own: through the label it would be named with its own text.
    <label htmlFor={id} className="relative -my-[9px] block py-[9px]">
    <Textarea
      id={id}
      aria-label="How to spot it"
      value={draft ?? description?.text ?? ""}
      onChange={e => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => {
        if (draft === null) return;
        const trimmed = draft.trim();
        // Nothing new, or emptied: back to the note as it stands.
        if (!trimmed || trimmed === (description?.text ?? "")) { setDraft(null); return; }
        const typed = draft;
        // Cleared once saved -- unless the pilot is typing again by then.
        // A failure keeps the text; the query client reports it.
        onSave(trimmed).then(() => setDraft(d => (d === typed ? null : d)), () => {});
      }}
      rows={1}
      placeholder={description?.source === "error" ? "Couldn't auto-generate — type one" : "How to spot it…"}
      // shadcn's own Textarea, sized down to a table cell: one line in
      // the row, at the row's own size -- 15 to a finger, where it was a
      // field's 17 among figures of 15 (iOS Safari zooms in on a field
      // under 16 only where the page lets it, and this one's viewport
      // does not: maximum-scale=1 in index.html).
      className={cn(
        "min-h-0 w-full resize-none rounded py-0.5 pr-1 pl-0.5 text-left align-top text-xs shadow-none md:text-xs pointer-coarse:text-[0.9375rem]",
        // On a selected row, a field: the page's own background and the
        // stock edge, on the selection's tint, so it reads as somewhere
        // to type rather than one more line of the row.
        selected
          ? "border-input bg-background text-foreground"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border focus:border-ring focus:bg-background",
      )}
    />
    </label>
  );
}

/**
 * The nav log itself -- the planner's own drawer content (in place of
 * a plain checkpoint list), so a pilot can walk the route's real
 * dead-reckoning numbers with the chart still visible beside it. The
 * walk is the point: Up/Down (PlanWorkspace's own keys) or a click steps
 * the selection through departure, every checkpoint and the
 * destination, the map follows to whichever is selected, and selecting
 * a point on the map (or another row) scrolls this one into view --
 * the same two-way link the old checkpoint list had.
 *
 * This panel is the briefing, in tabs: the nav log's own first -- the
 * totals above the table, the fuel check and the route's profile under
 * it -- and the briefing's parts in the others, from PlanWorkspace
 * (`tabContent`: FlightBriefingView's parts and the Brief's narrative). The two inputs the log is computed from, the
 * aeroplane and the departure time, are the panel's controls
 * (FlightInputs). The briefing
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
/** The leg's figures the drawer's table has no columns for, under the
 *  selected row -- on a desktop as on a phone, the pilot's preference for
 *  the compact log (every column is the printed page's alone, see the
 *  column defs): the heading worked out from the course -- true course, wind,
 *  correction, true heading, variation (the magnetic heading it ends in
 *  is the row's own) -- then the speeds and the fuel, in the nav log's
 *  own order. A grid of figures four across, each its shorthand over
 *  its value at the rows' own size; it was a run of "TC 327° Wind
 *  220°/28 WCA ..." breaking wherever the line ran out. (Their whole
 *  names were tried, two across, and the pilot kept the shorthand.) */
/** What a top of climb or descent's row says under it: the level, or
 *  the rate down and what to. */
function legPointNote(point: TopOfClimb | TopOfDescent, descent: TopOfDescent | null): string {
  if (!descent) return `Top of climb: level at ${feet(point.altitude_ft)}.`;
  return `Top of descent: ${descent.fpm} fpm down to ${feet(descent.to_ft)}${descent.pattern ? ", the pattern" : ""}.`;
}

function LegLine({ leg, at }: { leg: Leg; at: { name: string; lat: number; lon: number } }) {
  const figures: [string, string][] = [
    ["TC", deg(leg.true_course_deg)],
    ["Wind", leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data"],
    ["WCA", signed(leg.wca_deg)],
    ["TH", deg(leg.true_heading_deg)],
    ["Var", signed(leg.magnetic_variation_deg)],
    ["TAS", tas(leg)],
    ["GS", leg.groundspeed_kt === null ? "—" : String(Math.round(leg.groundspeed_kt))],
    ["Fuel", `${one(leg.fuel_gal)} gal`],
  ];
  return (
    // mb-5: the links' 44-point hit areas (index.css) reach 11 below them,
    // and the checkpoint's note's own tap band (DescriptionCell's label) 9
    // above it -- 20 between them, so neither takes the other's taps.
    <div className="mb-5 space-y-1 print:hidden">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-x-2 gap-y-1">
        {figures.map(([name, value]) => (
          <div key={name}>
            <dt className={TEXT.note}>{name}</dt>
            <dd className={cn("text-foreground tabular-nums", TEXT.detail)}>{value}</dd>
          </div>
        ))}
      </dl>
      {/* The same figures worked out, for a student to follow or try;
          and a diversion from the row's point, against the clock. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <LegWorkings leg={leg} />
        <DiversionDrill leg={leg} at={at} />
      </div>
    </div>
  );
}

/** The headings' size: a step above the rows' figures (the table's own
 *  size), 14 over 12, and to a finger 16 over 15 -- iOS's callout over
 *  its subheadline. A row's 17 was a tad big over them, the pilot said. */
const HEADING = "text-sm pointer-coarse:text-[1rem]";
/** A heading's unit, under its name: a note's 13 to a finger. */
const UNIT = "text-[0.6875rem] font-normal pointer-coarse:text-[0.8125rem] pointer-coarse:leading-[1.125rem]";

/** A column's heading: its short name over its unit, small, so both
 *  fit a phone's narrow columns ("Alt" over "ft", "MH" over "mag"), and
 *  its whole name for a screen reader, which read "MH" as "M H". */
function Heading({ name, unit, spoken }: { name: string; unit?: string; spoken: string }) {
  return (
    <>
      <span aria-hidden className="inline-flex flex-col items-end leading-tight">
        <span>{name}</span>
        {unit && <span className={UNIT}>{unit}</span>}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

/** The leg's true airspeed, in its own air (the planner's
 *  vfr.performance): it varies with the altitude and the forecast
 *  temperature, so each leg has its own. A dash from a planner that did
 *  not say. */
function tas(leg: Leg): string {
  return leg.tas_kt == null ? "—" : String(Math.round(leg.tas_kt));
}

export default function NavLogView({
  totals, nav, depart,
  legs, dep, dest, ends,
  selected, descriptions, onSaveDescription,
  onGenerateDescriptions, descriptionsLoading, tabContent, children, marks, notice, footer, titleNote, local = false, progress = null,
  selectedPoint, onSelectPoint, onDeselectPoint, drawerOpen,
  aircraftLabel,
}: Props) {
  const parts = totals ? totalsParts(totals) : null;
  // The nav log's section in one line under its title, folded or open,
  // as every section's is: the distance, the arrival and the fuel. Inside,
  // it is not said again; the altitude is the first row there (and the
  // Cruise Altitude section's line).
  // Each figure named, in the table's own shorthand, as the pilot
  // asked: "3h 14m" alone did not say it was the time. On one line, as
  // they asked too: to a finger at a note's 13, since at a summary's 15
  // the three ran to 293 points in a phone drawer's 277. Each figure
  // whole: a longer route breaks the line between them, not inside one.
  // The time as the arrival, the time en route after it: "ETA 18:24
  // (3h 22m)", as the pilot asked -- from the departure time picked, or
  // from now while it is "Now", which is what the plan is flown for then.
  const arrival = totals?.ete_min != null ? etaAt(depart || new Date().toISOString(), totals.ete_min) : null;
  const foldedSummary = parts && (
    <span className="pointer-coarse:text-[0.8125rem] pointer-coarse:leading-[1.125rem]">
      {(local ? [
        ["Aloft", parts.time],
        ["Back", arrival ?? "—"],
        ["Fuel", parts.fuel],
      ] as const : [
        ["Dist", parts.distance],
        ["ETA", arrival ? `${arrival} (${parts.time})` : parts.time],
        ["Fuel", parts.fuel],
      ] as const).map(([name, figure], i) => (
        <Fragment key={name}>{i > 0 && " · "}<span className="whitespace-nowrap" data-testid={name === "ETA" ? "navlog-eta" : undefined}>{name} {figure}</span></Fragment>
      ))}
    </span>
  );
  // While something is worked on, the line says what, with a spinner:
  // the summary once it is done.
  const progressLine = progress && (
    <span className="flex items-center gap-1.5 pointer-coarse:text-[0.8125rem] pointer-coarse:leading-[1.125rem]" role="status" data-testid="navlog-progress">
      <Spinner className="size-3.5 shrink-0" role="presentation" aria-label={undefined} aria-hidden />
      <span className="min-w-0">{progress}</span>
    </span>
  );
  // Which tab is up: the nav log's to begin with -- the Brief's narrative
  // is a billed call, asked for when its tab is opened -- and the nav
  // log's again when the drawer opens with a checkpoint picked on the map,
  // or one is picked with it open: that is what the pilot opened it to
  // see. Once per such pick; state adjusted during render, React's own
  // pattern for a change of props, rather than an effect that would
  // render the drawer twice.
  const [tab, setTab] = useState<PanelTab>("navlog");
  const pick = drawerOpen && selectedPoint ? descriptionKey(selectedPoint.lat, selectedPoint.lon) : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (pick !== openedFor) {
    setOpenedFor(pick);
    if (pick && tab !== "navlog") setTab("navlog");
  }
  // For the printer every tab, one after another -- the paper is the
  // whole briefing whatever was up on screen: set in the browser's own
  // beforeprint event, flushed before it lays the page out, and put back
  // after.
  // At half, the panel just tall enough for the tabs and the nav log's
  // line under them (PanelHalfContext, exact), the chart above it, at the
  // pilot's ask -- the rest a drag up. Measured, since the text size
  // changes both; a line's height under the tabs on any other tab.
  const halfNeeds = useContext(PanelHalfContext);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!root || !halfNeeds) return;
    const measure = () => {
      // Hidden under an airport's card (PlanWorkspace), the card says.
      if (!root.offsetParent) return;
      const tabs = root.querySelector('[role="tablist"]');
      const scroller = root.querySelector<HTMLElement>('[data-testid="navlog-scroller"]');
      const line = root.querySelector('[data-half-line]');
      if (!tabs || !scroller) return;
      // The line's foot in the scroller's content, however far it is
      // scrolled; on another tab, a line's height.
      const below = line ? line.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop
        : 3 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      halfNeeds(Math.round(tabs.getBoundingClientRect().bottom - root.getBoundingClientRect().top + below), true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => { observer.disconnect(); halfNeeds(null); };
  }, [root, halfNeeds, tab]);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  // One row per waypoint the plan knows about, regardless of how many
  // legs have streamed in: a row whose leg has not arrived shows a dash
  // in every column that needs one. Column defs are declared here, not
  // at module scope, since they close over this render's `nav` and
  // `depart`.
  const data = navLogRows(ends, selected, legs);
  // Whether the clouds the altitude breakdown found (14 CFR 91.155) can be
  // put on legs at all: its segments run fix to fix, as the rows do, so
  // they line up when there is one segment fewer than rows. When they do
  // not, the nav log's summary says so once.
  const segments = nav?.altitude_selection.segments ?? [];
  const perLeg = segments.length > 0 && segments.length === data.filter(r => !isLegPoint(r)).length - 1;
  // How the altitude was chosen -- the four plans, the pilot's own, and
  // why: a pilot should never have to take a cruise altitude on trust,
  // so the Alt column's own heading opens the planner's reasoning (floor,
  // ceiling, the rule, the weather checked) rather than a bare "(auto)".
  // The briefing's Cruise Altitude section carries the same steps onto
  // the paper.
  // On screen the table keeps five columns -- the waypoint, altitude,
  // distance, magnetic heading and ETE (and the ETA with a departure
  // time) -- and the others, which had it fourteen wide and scrolling
  // sideways, are the leg's figures under the selected row instead (see
  // LegLine). A desktop's drawer too, by the pilot's preference for the
  // phone's compact log: from md up it had every column, three of them in
  // view and the rest off its edge. On paper, every column. The heading
  // kept is the one a pilot steers: it was the true heading, with the
  // magnetic one only under the row.
  const columns: ColumnDef<typeof navLogTableFeatures, NavLogRow>[] = [
    {
      id: "waypoint",
      // The wand that fills the blank notes in -- one for the whole
      // log -- sits in this heading, beside the names it writes for,
      // rather than as a button of its own above the table. A wand,
      // not the narrative's own sparkles: this one acts on the rows,
      // where the narrative in the drawer's header writes a text of
      // its own.
      header: () => (
        <span className="inline-flex items-center">
          <IconButton
            // relative z-10: its 44-point hit area (index.css) over the
            // "Waypoint" beside it, which painted over the area's right.
            // -ml-2: the button's own clear padding laid over the cell's,
            // so its glyph lines up with the names under it and the
            // column is no wider than it was with a 24-point button --
            // the phone's five columns still fit their drawer.
            label="Generate descriptions" className="relative z-10 -ml-2 print:hidden"
            onClick={onGenerateDescriptions} disabled={descriptionsLoading || selected.length === 0}
            data-testid="generate-descriptions-button"
          >
            {/* The icon buttons' one size, 20 in 36 (it was 20 in 24, crowded). */}
            {descriptionsLoading
              ? <Loader2 className="size-5 animate-spin" />
              : <WandSparkles className="size-5" />}
          </IconButton>
          Waypoint
        </span>
      ),
      // The name alone: a leg the clouds leave no legal altitude on is
      // the briefing's to say (Current Conditions, the Cruise Altitude
      // reasoning), not a red mark by the waypoint, which the pilot found
      // one warning too many.
      cell: ({ row }) => rowPoint(row.original).name,
      // On a phone a name wraps, and a long word is hyphenated rather
      // than pushing the figures off the drawer's edge: with a
      // departure time's ETA as a sixth column, "Subdivision" alone was
      // wider than the room left. At a syllable, not anywhere: broken
      // anywhere, a name went "Clyma / n / Subdiv / ision".
      meta: { className: "text-left whitespace-normal hyphens-auto" },
    },
    {
      id: "alt",
      // How its altitudes were chosen opens from the altitude's own chip
      // beside the aeroplane (AltitudeButton), at the pilot's ask: it was
      // this column's head, out of sight with the panel down.
      header: () => <Heading name="Alt" unit="ft" spoken="Altitude, feet" />,
      // The last row lands at the destination -- shows its field
      // elevation, known immediately, rather than a cruise altitude.
      // A checkpoint's row shows the altitude of the leg that arrives
      // at it -- a plan may step, so each leg carries its own -- and
      // the plan's first altitude until that leg streams in.
      cell: ({ row }) => {
        const r = row.original;
        // A top of climb its level; a top of descent the level it leaves.
        if (isLegPoint(r)) return altFt(r.point.altitude_ft);
        // A waypoint flown through, as a checkpoint: the leg's altitude.
        const flownThrough = r.kind === "checkpoint" || (r.kind === "stop" && r.airport.kind === "fix");
        return altFt(flownThrough ? (r.leg?.altitude_ft ?? nav?.altitude_ft) : r.airport.elevation_ft);
      },
    },
    {
      id: "dist",
      header: () => <Heading name="Dist" unit="nm" spoken="Distance, nautical miles" />,
      cell: ({ row }) => (legOf(row.original) ? legOf(row.original)!.distance_nm.toFixed(1) : "—"),
    },
    {
      id: "tc",
      header: () => <Heading name="TC" unit="true" spoken="True course" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => (legOf(row.original) ? deg(legOf(row.original)!.true_course_deg) : "—"),
    },
    {
      id: "wind",
      header: () => <Heading name="Wind" unit="°/kt" spoken="Wind, direction and speed" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => {
        const leg = legOf(row.original);
        return leg ? (leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data") : "—";
      },
    },
    {
      id: "wca",
      header: () => <Heading name="WCA" unit="°" spoken="Wind correction angle" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => (legOf(row.original) ? signed(legOf(row.original)!.wca_deg) : "—"),
    },
    {
      id: "th",
      header: () => <Heading name="TH" unit="true" spoken="True heading" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => (legOf(row.original) ? deg(legOf(row.original)!.true_heading_deg) : "—"),
    },
    {
      id: "var",
      header: () => <Heading name="Var" unit="°" spoken="Magnetic variation" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => (legOf(row.original) ? signed(legOf(row.original)!.magnetic_variation_deg) : "—"),
    },
    {
      id: "mh",
      header: () => <Heading name="MH" unit="mag" spoken="Magnetic heading" />,
      cell: ({ row }) => (legOf(row.original) ? deg(legOf(row.original)!.magnetic_heading_deg) : "—"),
    },
    {
      // Each leg's own: the aeroplane's cruise in the forecast air at the
      // leg's altitude, which is why it is a column (the altitude's
      // reasoning says how it is worked out).
      id: "tas",
      header: () => <Heading name="TAS" unit="kt" spoken="True airspeed, knots" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => {
        const leg = legOf(row.original);
        return leg ? tas(leg) : "—";
      },
    },
    {
      id: "gs",
      header: () => <Heading name="GS" unit="kt" spoken="Groundspeed, knots" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => {
        const leg = legOf(row.original);
        return leg ? (leg.groundspeed_kt === null ? "—" : Math.round(leg.groundspeed_kt)) : "—";
      },
    },
    {
      id: "ete",
      header: () => <Heading name="ETE" unit="min" spoken="Time en route, minutes" />,
      cell: ({ row }) => {
        const leg = legOf(row.original);
        return leg ? (leg.ete_min === null ? "unflyable" : one(leg.ete_min)) : "—";
      },
    },
    {
      id: "fuel",
      header: () => <Heading name="Fuel" unit="gal" spoken="Fuel, gallons" />,
      meta: { className: "hidden print:table-cell" },
      cell: ({ row }) => (legOf(row.original) ? one(legOf(row.original)!.fuel_gal) : "—"),
    },
  ];
  // With a departure time, every row gets its ETA: the departure's own
  // time, then the time each leg ends -- "—" from the first leg that is
  // not in yet or cannot be flown (see navLogRows).
  const etaColumn: ColumnDef<typeof navLogTableFeatures, NavLogRow> = {
    id: "eta",
    header: () => <Heading name="ETA" unit="local" spoken="Arrival time, local" />,
    cell: ({ row }) => etaAt(depart, row.original.minutesFlown),
  };
  if (depart) columns.push(etaColumn);
  // On paper only: the two columns a pilot fills in by hand in flight,
  // the actual time over each fix and the fuel left -- what makes the
  // printed page a nav log to fly with rather than a table to read.
  for (const [id, name, unit, spoken] of [
    ["ata", "ATA", "local", "Actual arrival time"], ["fuel_rem", "Fuel rem.", "gal", "Fuel remaining, gallons"],
  ] as const) {
    columns.push({
      id, header: () => <Heading name={name} unit={unit} spoken={spoken} />,
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
  // Whether the table fits the drawer's width (see navLogTable): watched,
  // since a departure time adds a column and the text size moves every
  // one of them. From a ref, not an effect: the table is there only
  // while the nav log's section is open, mounted afresh each time.
  const [fits, setFits] = useState(true);
  const watchFit = useCallback((box: HTMLDivElement | null) => {
    const table = box?.querySelector("table");
    if (!box || !table || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFits(table.offsetWidth <= box.clientWidth + 1));
    observer.observe(box);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);
  // Selecting a point on the map should be as visible here as
  // clicking the row itself would have been -- otherwise the
  // highlighted row can be scrolled out of view in this (now often
  // narrow, since it's a draggable sidebar) column and looks like
  // nothing happened. Brought to the middle when it is out of view
  // (a point picked on the map, the drawer opened after), left where
  // it is when it is not (the row itself clicked). On the nav log's
  // own section opening too: on a phone the drawer is mounted afresh
  // each time it opens, with every section closed, and the row is only
  // there to reveal once that section has been opened -- and on that
  // section alone, not on any section: opening the winds or the
  // NOTAMs further down used to scroll the drawer back up to the
  // selected row. And on the drawer opening: beside a desktop map the
  // view is mounted, and its rows laid out, while the drawer is
  // closed, so a row revealed then was revealed off screen. (Its tab
  // now, where it was its section.)
  const navLogOpen = tab === "navlog";
  useEffect(() => revealRow(selectedRef.current), [selectedPoint, navLogOpen, drawerOpen]);
  const isSelected = (lat: number, lon: number) =>
    !!selectedPoint && descriptionKey(lat, lon) === descriptionKey(selectedPoint.lat, selectedPoint.lon);

  // The table itself. With the briefing's sections under it, the table
  // scrolls sideways inside its own container so the sections below
  // stay put -- when it is wider than the drawer: the five columns with
  // the text set large, or in a window as narrow as Slide Over's. While it
  // fits, the container lets its overflow go, so that its headings can
  // stay at the top of the drawer as the log scrolls under them (a
  // sideways scroller holds a sticky heading to itself). Printed,
  // nothing scrolls: every column is laid out for the browser to
  // paginate.
  const navLogTable = (
    <div ref={watchFit}>
    <Table
      containerClassName={cn(fits ? "overflow-x-visible" : "overflow-x-auto", "print:overflow-visible")}
      className={cn(
        // The cells' padding halved and the waypoint's name free to wrap
        // (see its column), so the five columns fit the drawer without a
        // sideways scroll -- beside a desktop's map as on a phone, where
        // every column of it scrolled sideways under the waypoint's. On
        // paper, every column at the stock padding.
        "text-right text-xs whitespace-nowrap [&_td]:px-1 [&_th]:px-1 print:[&_td]:px-2 print:[&_th]:px-2",
        // To a finger, the figures at what is read (15) and the rows 44
        // points to tap (lib/text.ts), as the pilot had them: 12 on a
        // phone was too small to read. (What they had asked to have
        // compact was the leg's figures under a row, LegLine.)
        "pointer-coarse:text-[0.9375rem] pointer-coarse:[&_td]:py-3",
      )}
    >
      <TableCaption className="sr-only">
        Navigation log from {dep} to {dest}
      </TableCaption>
      <TableHeader className="sticky top-0 z-10 bg-background print:static print:bg-transparent dark:bg-popover">
        {table.getHeaderGroups().map(headerGroup => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map(header => (
              // Each heading over its own figures: right-aligned, as they
              // are (the stock heading is left-aligned, and every label
              // sat off its column), the waypoint's left as its names
              // are; a step above the rows (HEADING), in black over figures
              // in grey (see SelectableRow), as the pilot asked.
              <TableHead key={header.id} className={cn("text-right text-foreground", HEADING, header.column.columnDef.meta?.className)}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {data.length === 0 && (
          <TableRow><TableCell className="text-left text-muted-foreground" colSpan={columns.length}>No route planned yet</TableCell></TableRow>
        )}
        {/* One row per waypoint the plan already knows about, not
            one per leg that's actually arrived -- `leg` is
            undefined until its own line streams in, and every cell
            that depends on it shows a dash rather than waiting. The
            departure (when present) is `table`'s own first row,
            one kind of row among the three -- see rows.ts. */}
        {table.getRowModel().rows.map(row => {
          const r = row.original;
          const { lat, lon } = rowPoint(r);
          const rowSelected = isSelected(lat, lon);
          const leg = legOf(r);
          return (
            <Fragment key={row.id}>
              {/* A leg with no nearby winds-aloft station is a
                  no-wind estimate, not a calm one. Italics keep that
                  visible rather than letting it read as a confident
                  zero -- as for a leg that simply hasn't arrived yet,
                  for the same reason: both are "no data (yet)," not a
                  confident answer. They were the grey rows, before
                  every row's figures were grey. */}
              <SelectableRow
                selected={rowSelected}
                kind={r.kind}
                estimated={r.kind !== "departure" && !leg?.wind}
                expands
                // The selected row tapped again is deselected, on the
                // map too, which closes its note.
                onSelect={() => (rowSelected ? onDeselectPoint() : onSelectPoint(lat, lon))}
                scrollRef={rowSelected ? selectedRef : undefined}
              >
                {row.getAllCells().map(cell => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </SelectableRow>
              {/* The row's own note -- the leg's figures a phone has no
                  columns for, and the checkpoint's description or the
                  airport's name -- under the selected row only, the way
                  the training drawer's rating buttons are: every row
                  open at once was three rows a waypoint, and a log of
                  twenty scrolled for a screen and a half. A tap on a row
                  selects it, on the map too, and opens it. On paper
                  every row is open. */}
              {(rowSelected || printing) && (
              <NoteRow selected={rowSelected} colSpan={columns.length}>
                {leg && <LegLine leg={leg} at={rowPoint(r)} />}
                {r.kind === "departure" ? (
                  // The departure airport's own name, not editable
                  // and never AI-generated -- there's no "how to
                  // spot it" for an airport and no LLM service
                  // behind this one, just a fact the course
                  // response already carries. Same slot a
                  // checkpoint's own description sits in, and
                  // inverts the same way when selected, so the
                  // pair still reads as one group.
                  (r.airport.name ?? "—")
                ) : isLegPoint(r) ? (
                  legPointNote(r.point, r.kind === "tod" ? r.point : null)
                ) : r.kind === "checkpoint" ? (
                  <DescriptionCell
                    description={descriptions[r.key]}
                    onSave={text => onSaveDescription(r.cp.lat, r.cp.lon, text)}
                    selected={rowSelected}
                    onFocus={() => onSelectPoint(r.cp.lat, r.cp.lon)}
                  />
                ) : (
                  // The destination airport's own name -- same
                  // plain, non-editable treatment as the
                  // departure's own row above; see NoteRow's own
                  // comment.
                  (r.airport.name ?? "—")
                )}
              </NoteRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );

  // What has to be said over the table, as rows: legs flown without wind,
  // and clouds the legs cannot be told for, in red. Nothing at all when
  // there is none of it: the arrival is the section's own line, and the
  // table is the rest, as the pilot asked. (The altitude, which opens how
  // it was chosen, is the Alt column's head.)
  const cloudsUnplaced = !!nav && !nav.altitude_selection.cloud_clearance_kept && !perLeg;
  const summary = (!!parts?.warning || cloudsUnplaced) && (
    <div className="mb-3" data-testid="navlog-summary">
      <ListGroup>
        {parts?.warning && <ListRow title={<span className="text-destructive">{parts.warning}</span>} />}
        {/* The clouds forecast near a leg leave it no legal altitude (14
            CFR 91.155): the plan still stands, over the band without
            them, and the briefing says so (Current Conditions, the
            reasoning) -- here as well only when the legs cannot be told. */}
        {nav && cloudsUnplaced && (
          <ListRow
            title={<span className="text-destructive">Too low for VFR under the clouds near {nav.altitude_selection.cloud_station}</span>}
            description="No altitude keeps 500 ft below the forecast clouds there"
          />
        )}
      </ListGroup>
    </div>
  );

  // The fuel check (14 CFR 91.151): the legs' fuel plus the reserve --
  // 30 minutes by day, 45 at night, the day one assumed and said so
  // without a departure time -- against the aeroplane's usable fuel
  // when it has one, red when the tanks do not hold it. Under the
  // table, where the fuel column it sums ends, rather than among the
  // totals above it: rows like theirs, each figure at its row's end and
  // what the fuel allows for under its name, where it was a sentence of
  // two or three lines.
  const fuelShort = totals?.fuel_margin_gal != null && totals.fuel_margin_gal < 0 ? -totals.fuel_margin_gal : null;
  // A route with stops: the tanks are filled at each, so each flight
  // between two landings has its own check (app.planning.route_totals),
  // a row each -- what it needs, against the tanks.
  const hopsNote = totals && totals.hops.length > 0 && (
    <div className="mt-3" data-testid="fuel-check">
      <ListGroup title="Fuel, stop to stop" footer="The tanks filled at each stop: each flight is checked on its own, with its reserve.">
        {totals.hops.map(({ departure, destination, totals: hop }) => {
          const short = hop.fuel_margin_gal != null && hop.fuel_margin_gal < 0 ? -hop.fuel_margin_gal : null;
          return (
            <ListRow
              key={`${departure}-${destination}`} title={`${departure} → ${destination}`}
              description={`${one(hop.distance_nm)} nm, with a ${hop.reserve_min} min reserve`}
              value={hop.fuel_required_gal == null ? "—" : short === null
                ? `${one(hop.fuel_required_gal)}${hop.usable_fuel_gal != null ? ` of ${hop.usable_fuel_gal}` : ""} gal`
                : <span className="font-semibold text-destructive">{one(hop.fuel_required_gal)} gal, {one(short)} short</span>}
            />
          );
        })}
      </ListGroup>
    </div>
  );
  const fuelNote = totals && totals.fuel_required_gal != null && (
    <div className="mt-3" data-testid="fuel-check">
      <ListGroup>
        <ListRow
          title="Fuel required"
          description={`With ${one(totals.taxi_gal)} gal to start, taxi and take off, and a ${totals.reserve_min} min ${
            totals.night == null ? "day reserve (no departure time)" : totals.night ? "night reserve" : "day reserve"}`}
          value={`${one(totals.fuel_required_gal)} gal`}
        />
        {totals.usable_fuel_gal != null && (
          <ListRow
            title="Usable fuel"
            value={fuelShort === null ? `${totals.usable_fuel_gal} gal`
              : <span className="font-semibold text-destructive">{totals.usable_fuel_gal} gal, {one(fuelShort)} short</span>}
          />
        )}
      </ListGroup>
    </div>
  );

  return (
    // print:h-auto print:overflow-visible: on screen this fills a fixed
    // viewport height and clips to it, deliberately -- on paper there
    // is no viewport to clip to, and a route long enough to scroll
    // would otherwise print only whatever page's worth happened to be
    // visible.
    <Tabs ref={setRoot} value={tab} onValueChange={value => setTab(value as PanelTab)} className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden print:h-auto print:overflow-visible">
      {/* Printed, this header is the briefing's title: the panel's own
          head (the route form, the aeroplane and the departure time) is
          print:hidden, so they are named here instead, as a line of
          text. On screen the name is the panel's tab's, said once there;
          here it is for a screen reader. */}
      <span className="sr-only" data-testid="drawer-title">Flight Planning</span>
      <div className="hidden flex-col gap-1 border-b border-border px-4 py-3 text-sm print:flex">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-semibold", TEXT.title)}>Wingtip Maps</span>
          <span className="text-muted-foreground">{routeName(dep, dest, ends?.stops?.map(s => s.ident))}</span>
        </div>
        <div className="text-muted-foreground">
          {aircraftLabel}
          {depart && ` · departing ${new Date(depart).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${clockTime(new Date(depart))}`}
        </div>
      </div>
      {/* The panel's tabs, at the pilot's ask: one thing at a time, where
          one accordion held every section, the nav log's first. The stock
          line tabs, as the consoles' (ConsoleTabs), over the scroller so
          they stay as it scrolls: an icon over its word, the word at iOS
          tab bar's own fixed size (it does not grow with the text, as
          iOS's does not), so the five share the line evenly. A tab whose
          part has a warning -- VFR not recommended, a TFR on the route, a
          raised risk -- carries a red mark, as the sections' titles did. */}
      <TabsList
        variant="line"
        className="h-auto w-full shrink-0 gap-0 border-b border-border px-[max(0.25rem,env(safe-area-inset-left))] group-data-[orientation=horizontal]/tabs:h-auto pointer-coarse:group-data-[orientation=horizontal]/tabs:h-auto print:hidden"
      >
        {TABS.map(t => (
          <TabsTrigger
            key={t.value} value={t.value} data-testid={`panel-tab-${t.value}`}
            className={cn(LINE_TAB, "min-w-0 flex-1 flex-col gap-0.5 px-0.5 py-1.5 text-[11px] leading-tight pointer-coarse:text-[11px] pointer-coarse:max-[374px]:text-[11px] max-[374px]:px-0 [&_svg]:size-5")}
          >
            <span className="relative">
              {t.icon}
              {marks?.[t.value] && <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-destructive" data-testid={`panel-tab-mark-${t.value}`} />}
            </span>
            <span className="truncate">{t.value === "navlog" && local ? "Local Flight" : t.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <div
        // The bottom inset clears the home indicator on an installed
        // app, so the last section's content is not under it.
        // `@container`: the summary line below keeps to one line from
        // 18rem of this width -- a container query, so with the text
        // set larger (the root font size up, the rem with it) the line
        // wraps rather than running off the edge. `flight-briefing`:
        // index.css's print rules lay every tab out on paper.
        className="flight-briefing @container min-h-0 flex-1 overflow-auto pr-4 pb-[env(safe-area-inset-bottom)] pl-[max(1rem,env(safe-area-inset-left))] print:h-auto print:overflow-visible print:pb-0"
        data-testid="navlog-scroller"
      >
        {notice}
        <SectionsOpen.Provider value>
          {(printing ? PRINTED : [tab]).map(t => (
            <TabsContent key={t} value={t} forceMount={printing || undefined} className="mt-0" data-testid={`panel-${t}`}>
              {t === "navlog" ? (
                <section aria-label={local ? "Local Flight" : "Nav Log"} className={TEXT.prose}>
                  {/* The section in one line, as its title's summary was: the
                      distance, the arrival and the fuel, or what is being
                      worked on; beside it a mark that opens to a note (a
                      tight altitude, Class B accepted). */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-3" data-half-line="">
                    <span className={cn("text-muted-foreground", TEXT.prose)} data-slot="section-summary">{progressLine ?? foldedSummary}</span>
                    {titleNote}
                  </div>
                  {!local && summary}
                  {!local && navLogTable}
                  {fuelNote}
                  {!local && hopsNote}
                  {/* The same legs from the side, and the figures the
                      altitude was chosen within: asked for once the log is
                      whole, so its terrain read does not hold up the legs'
                      (the planner is one process). */}
                  {!local && ends && <RouteProfileSection ends={ends} rows={data} wanted={!!totals || printing} />}
                  {!local && tabContent("profile")}
                </section>
              ) : tabContent(t)}
            </TabsContent>
          ))}
        </SectionsOpen.Provider>
        {footer}
      </div>
      {children}
    </Tabs>
  );
}
