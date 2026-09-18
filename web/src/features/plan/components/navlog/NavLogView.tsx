import { Fragment, useEffect, useRef, useState, type Ref } from "react";
import clsx from "clsx";
import { Loader2, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { useIsMobile } from "../../../../hooks/use-mobile";
import type { Candidate, Leg, NavLog, Totals } from "../../../../lib/api/types";
import { type Description, descriptionKey } from "../../hooks/usePlanState";
import { altFt, deg, one, signed, totalsParts } from "../../format";

interface Props {
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  /** The pilot's own cruise-altitude override -- lives here, not the
   *  map header's route form, since this is where the *result*
   *  (`nav.altitude_ft`/`nav.altitude_selection`) already shows: typing
   *  a new one and seeing what it changes is one place, not two. Wired
   *  to the same `onSubmit` PlanView's own "Chart" button calls, so
   *  Enter here re-plans the exact same way that button does. */
  alt: string;
  onAltChange: (v: string) => void;
  onSubmit: () => void;
  /** Streamed in one at a time, in the same order as `selected` --
   *  `legs[i]` is the leg that arrives at `selected[i]`, one short of
   *  `selected.length + 1` until the final leg (to the destination)
   *  streams in. A row is drawn for every waypoint in `selected` and
   *  the destination regardless of how many legs have arrived yet --
   *  the ones without a leg show placeholders rather than waiting. */
  legs: Leg[];
  navError: string | null;
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
  /** The sidebar's own width toggle -- widened enough to show every
   *  column of this table without its own horizontal scroll, lives
   *  here (not floating over the map) since it's this table's own
   *  width the button actually changes. Shell reads the same
   *  `expanded` value to size the sidebar itself. */
  expanded: boolean;
  onToggleExpanded: () => void;
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
      className={clsx(
        "w-full resize-none rounded border py-0.5 pr-1 pl-0.5 text-left align-top text-xs focus:outline-none",
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
    <tr
      ref={scrollRef}
      onClick={onSelect}
      tabIndex={0}
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
          ? "bg-foreground text-background"
          : clsx(mutedWhenUnselected && "text-muted-foreground", "hover:bg-accent focus-visible:bg-accent"),
      )}
    >
      {children}
    </tr>
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
    <tr className={clsx("border-b border-border", selected && "bg-foreground text-background")}>
      <td
        className={clsx("py-1 pr-2 pl-4 text-left text-xs", !selected && "bg-muted/60 text-muted-foreground")}
        colSpan={12}
      >
        {children}
      </td>
    </tr>
  );
}

/**
 * The nav log itself -- the planner's own draggable sidebar content
 * (in place of a plain checkpoint list), so a pilot can walk the
 * route's real dead-reckoning numbers with the chart still visible
 * beside it, and reused as-is for the full-page "Flight Briefing"
 * (there, wider and print-styled, with nothing else competing for the
 * screen). Every row is clickable either way -- selecting one focuses
 * that point on the map, and selecting a point on the map (or another
 * row) scrolls this one into view, the same two-way link the old
 * checkpoint list had.
 *
 * One row per waypoint, not one row per leg with both its ends named
 * on it -- a paper nav log runs down the page checkpoint by checkpoint,
 * each one's row holding the leg it took to get there. The departure
 * is the exception: it opens the log with nothing to its right, since
 * no leg has been flown yet.
 */
export default function NavLogView({
  totals, nav, legs, navError, dep, dest, depName, destName, depLat, depLon, destLat, destLon,
  selected, depElevationFt, destElevationFt, descriptions, onSaveDescription,
  onGenerateDescriptions, descriptionsLoading, expanded, onToggleExpanded,
  selectedPoint, onSelectPoint, alt, onAltChange, onSubmit,
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
  // The expand toggle changes `--sidebar-width`, a CSS var the mobile
  // Sheet ignores -- it hardcodes its own width regardless (see
  // Shell's own Sidebar usage) -- so the button would sit there doing
  // nothing visible below shadcn's own mobile breakpoint. Same check
  // shadcn's own Sidebar uses to decide Sheet vs. plain panel in the
  // first place, not a separate guess at the same breakpoint.
  const isMobile = useIsMobile();

  return (
    // print:h-auto print:overflow-visible: on screen this fills a fixed
    // viewport height and clips to it, deliberately -- on paper there
    // is no viewport to clip to, and a route long enough to scroll
    // would otherwise print only whatever page's worth happened to be
    // visible.
    <div className="flex h-full flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
      <div className="flex flex-col gap-1 border-b border-border p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-muted-foreground">Nav log</span>
          <div className="ml-auto flex items-center gap-1 print:hidden">
            <Button
              variant="ghost" size="icon"
              onClick={onGenerateDescriptions} disabled={descriptionsLoading || selected.length === 0}
              title="Generate checkpoint descriptions" aria-label="Generate checkpoint descriptions"
              data-testid="generate-descriptions-button"
            >
              {descriptionsLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            </Button>
            {!isMobile && (
              <Button
                variant="ghost" size="icon"
                onClick={onToggleExpanded}
                title={expanded ? "Shrink nav log" : "Expand nav log"}
                aria-label={expanded ? "Shrink nav log" : "Expand nav log"}
                data-testid="sidebar-expand-toggle"
              >
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            )}
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
              {nav.altitude_selection
                ? `(auto: floor ${nav.altitude_selection.floor_ft} ft, ${nav.aircraft.name})`
                : "(you set this)"}
            </span>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 print:h-auto print:overflow-visible" data-testid="navlog-scroller">
        {/* border-collapse plus a left border per cell (none on the
            first) reads as one ruled line per column boundary instead
            of the double-thick line adjacent borders would otherwise
            draw -- twelve columns of numbers is a lot to track by
            eye-position alone without them. Padding is a Tailwind class
            on every cell, not the legacy `cellPadding` attribute --
            Preflight resets `td, th { padding: 0 }`, which is CSS and
            wins over that attribute, so the attribute alone rendered
            every column crammed flush against the next. */}
        <table className="border-collapse text-right text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-1 text-left">Waypoint</th>
              <th className="border-l border-border px-2 py-1 font-normal">
                <form onSubmit={e => { e.preventDefault(); onSubmit(); }}>
                  <Input
                    value={alt}
                    onChange={e => onAltChange(e.target.value)}
                    placeholder="Alt"
                    spellCheck={false}
                    aria-label="Cruise altitude, feet"
                    className="h-6 w-14 px-1 text-right text-xs print:hidden"
                  />
                  <span className="hidden print:inline">Alt</span>
                </form>
              </th>
              <th className="border-l border-border px-2 py-1">Dist</th>
              <th className="border-l border-border px-2 py-1">TC</th>
              <th className="border-l border-border px-2 py-1">Wind</th>
              <th className="border-l border-border px-2 py-1">WCA</th>
              <th className="border-l border-border px-2 py-1">TH</th>
              <th className="border-l border-border px-2 py-1">Var</th>
              <th className="border-l border-border px-2 py-1">MH</th>
              <th className="border-l border-border px-2 py-1">GS</th>
              <th className="border-l border-border px-2 py-1">ETE</th>
              <th className="border-l border-border px-2 py-1">Fuel</th>
            </tr>
          </thead>
          <tbody>
            {navError && (
              <tr><td className="px-2 py-1 text-left text-destructive" colSpan={12}>{navError}</td></tr>
            )}
            {!navError && selected.length === 0 && (
              <tr><td className="px-2 py-1 text-left text-muted-foreground" colSpan={12}>No route planned yet</td></tr>
            )}
            {/* A real nav log runs down the page one waypoint at a time,
                not one leg with both its ends spelled out on the same
                row -- the departure gets its own row with nothing to
                its right (no leg has been flown yet), and every row
                after that is the leg it took to reach that waypoint.
                Drawn from `dep`/`depElevationFt` directly, not the
                first leg: the departure is known the instant a route
                is chosen, well before its own leg (the one that pays
                for the aviationweather.gov round trip) streams in. */}
            {selected.length > 0 && (() => {
              const depSelected = isSelected(depLat, depLon);
              return (
                <>
                  <SelectableRow
                    selected={depSelected}
                    mutedWhenUnselected
                    onSelect={() => onSelectPoint(depLat, depLon)}
                    scrollRef={depSelected ? selectedRef : undefined}
                  >
                    <td className="px-2 py-1 text-left">{dep}</td>
                    <td className="border-l border-border px-2 py-1">{altFt(depElevationFt)}</td>
                    {Array.from({ length: 10 }, (_, i) => (
                      <td key={i} className="border-l border-border px-2 py-1">—</td>
                    ))}
                  </SelectableRow>
                  {/* The airport's own name, not editable and never
                      AI-generated -- there's no "how to spot it" for an
                      airport and no LLM service behind this one, just a
                      fact the course response already carries. Same
                      slot a checkpoint's own description sits in, and
                      inverts the same way when selected, so the pair
                      still reads as one group. */}
                  <NoteRow selected={depSelected}>{depName ?? "—"}</NoteRow>
                </>
              );
            })()}
            {/* One row per waypoint the plan already knows about, not
                one per leg that's actually arrived -- `leg` is
                undefined until its own line streams in, and every cell
                that depends on it shows a dash rather than waiting. */}
            {waypoints.map(({ cp, name, lat, lon, leg }, i) => {
              const rowSelected = isSelected(lat, lon);
              return (
                <Fragment key={i}>
                  {/* A leg with no nearby winds-aloft station is a
                      no-wind estimate, not a calm one. Shading keeps
                      that visible rather than letting it read as a
                      confident zero -- the same shade a leg that simply
                      hasn't arrived yet gets, for the same reason: both
                      are "no data (yet)," not a confident answer. */}
                  <SelectableRow
                    selected={rowSelected}
                    mutedWhenUnselected={!leg?.wind}
                    onSelect={() => onSelectPoint(lat, lon)}
                    scrollRef={rowSelected ? selectedRef : undefined}
                  >
                    <td className="px-2 py-1 text-left">{name}</td>
                    {/* The last row lands at the destination -- shows its
                        field elevation, known immediately, rather than
                        the cruise altitude every checkpoint before it
                        flies at (which isn't known until the "altitude"
                        message arrives, either -- hence `nav?.`). */}
                    <td className="border-l border-border px-2 py-1">
                      {altFt(cp ? nav?.altitude_ft : destElevationFt)}
                    </td>
                    <td className="border-l border-border px-2 py-1">{leg ? leg.distance_nm.toFixed(1) : "—"}</td>
                    <td className="border-l border-border px-2 py-1">{leg ? deg(leg.true_course_deg) : "—"}</td>
                    <td className="border-l border-border px-2 py-1">{leg
                      ? (leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data")
                      : "—"}</td>
                    <td className="border-l border-border px-2 py-1">{leg ? signed(leg.wca_deg) : "—"}</td>
                    <td className="border-l border-border px-2 py-1">{leg ? deg(leg.true_heading_deg) : "—"}</td>
                    <td className="border-l border-border px-2 py-1">{leg ? signed(leg.magnetic_variation_deg) : "—"}</td>
                    <td className="border-l border-border px-2 py-1">{leg ? deg(leg.magnetic_heading_deg) : "—"}</td>
                    <td className="border-l border-border px-2 py-1">
                      {leg ? (leg.groundspeed_kt === null ? "—" : Math.round(leg.groundspeed_kt)) : "—"}
                    </td>
                    <td className="border-l border-border px-2 py-1">
                      {leg ? (leg.ete_min === null ? "unflyable" : one(leg.ete_min)) : "—"}
                    </td>
                    <td className="border-l border-border px-2 py-1">{leg ? one(leg.fuel_gal) : "—"}</td>
                  </SelectableRow>
                  <NoteRow selected={rowSelected}>
                    {cp ? (
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
