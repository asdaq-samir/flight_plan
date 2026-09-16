import { Fragment, useEffect, useRef, useState } from "react";
import type { Candidate, Leg, NavLog, Totals } from "../../../../lib/api/types";
import { type Description, descriptionKey } from "../../hooks/usePlanState";
import { altFt, deg, one, signed, totalsParts } from "../../format";

interface Props {
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
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
  /** The pilot's own opt-out for the per-checkpoint LLM descriptions
   *  -- turning it off stops the stream itself (see PlanView), not
   *  just this view's own rendering of it. */
  showDescriptions: boolean;
  onToggleShowDescriptions: (checked: boolean) => void;
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
 * One checkpoint's "how to spot it" text -- editable, streamed in
 * separately from the rest of the row, so it starts as a placeholder
 * and fills in on its own once the description stream reaches it.
 * Local draft state is what lets typing feel immediate without saving
 * on every keystroke; the save itself happens on blur.
 */
function DescriptionCell({
  description, onSave,
}: {
  description: Description | undefined;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(description?.text ?? "");
  // A fresh arrival from the stream (or someone else's edit) should
  // overwrite an untouched draft -- but not fight typing in progress,
  // which is why this only runs when the underlying text itself changes.
  useEffect(() => { setDraft(description?.text ?? ""); }, [description?.text]);

  if (!description) {
    return <span className="italic text-slate-400">Generating description…</span>;
  }
  return (
    <textarea
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== description.text) onSave(trimmed);
      }}
      rows={1}
      placeholder={description.source === "error" ? "Couldn't auto-generate — type one" : "How to spot it…"}
      className="w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-left align-top text-xs text-slate-600 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
    />
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
  totals, nav, legs, navError, dep, dest, depLat, depLon, destLat, destLon,
  selected, depElevationFt, destElevationFt, descriptions, onSaveDescription,
  showDescriptions, onToggleShowDescriptions, selectedPoint, onSelectPoint,
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

  return (
    // print:h-auto print:overflow-visible: on screen this fills a fixed
    // viewport height and clips to it, deliberately -- on paper there
    // is no viewport to clip to, and a route long enough to scroll
    // would otherwise print only whatever page's worth happened to be
    // visible.
    <div className="flex h-full flex-col overflow-hidden bg-white print:h-auto print:overflow-visible">
      {/* pr-28: NavLogActions' map/print pair floats over this view,
          top-right -- two 40px buttons, an 8px gap between them, and a
          12px offset from the edge is 100px of real footprint. pr-20
          (80px) fell 20px short of that: harmless while nothing in the
          row reached the actual right edge, but the checkbox below is
          `ml-auto`, so it's the first thing here that actually butts
          up against this padding -- and did, right under the buttons.
          min-h-16: those same buttons sit at a fixed 12px+40px+12px
          footprint (64px) independent of this row's own content height
          (this row's text alone is only ~44px tall) -- without matching
          it, `items-center` centers the checkbox within a shorter row
          than the buttons actually occupy, landing it a few px above
          their true center instead of level with them. */}
      <div className="flex min-h-16 flex-wrap items-center gap-2 border-b border-slate-200 p-3 pr-28 text-sm print:min-h-0 print:pr-3">
        <span className="font-semibold text-slate-700">Nav log</span>
        {parts && (
          <span>
            <b>{parts.distance}</b> · <b>{parts.time}</b> · <b>{parts.fuel}</b>
            {parts.warning && <> · <span className="text-red-600">{parts.warning}</span></>}
          </span>
        )}
        {nav && (
          <span className="text-slate-500">
            {nav.altitude_ft} ft{" "}
            {nav.altitude_selection
              ? `(auto: floor ${nav.altitude_selection.floor_ft} ft, ${nav.aircraft.name})`
              : "(you set this)"}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-slate-500 print:hidden">
          <input
            type="checkbox"
            checked={showDescriptions}
            onChange={e => onToggleShowDescriptions(e.target.checked)}
            className="h-3.5 w-3.5 accent-slate-700"
          />
          Checkpoint descriptions
        </label>
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
            <tr className="border-b border-slate-200">
              <th className="px-2 py-1 text-left">Waypoint</th>
              <th className="border-l border-slate-200 px-2 py-1">Alt</th>
              <th className="border-l border-slate-200 px-2 py-1">Dist</th>
              <th className="border-l border-slate-200 px-2 py-1">TC</th>
              <th className="border-l border-slate-200 px-2 py-1">Wind</th>
              <th className="border-l border-slate-200 px-2 py-1">WCA</th>
              <th className="border-l border-slate-200 px-2 py-1">TH</th>
              <th className="border-l border-slate-200 px-2 py-1">Var</th>
              <th className="border-l border-slate-200 px-2 py-1">MH</th>
              <th className="border-l border-slate-200 px-2 py-1">GS</th>
              <th className="border-l border-slate-200 px-2 py-1">ETE</th>
              <th className="border-l border-slate-200 px-2 py-1">Fuel</th>
            </tr>
          </thead>
          <tbody>
            {navError && (
              <tr><td className="px-2 py-1 text-left text-red-600" colSpan={12}>{navError}</td></tr>
            )}
            {!navError && selected.length === 0 && (
              <tr><td className="px-2 py-1 text-left text-slate-500" colSpan={12}>No route planned yet</td></tr>
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
            {selected.length > 0 && (
              <tr
                ref={isSelected(depLat, depLon) ? selectedRef : undefined}
                onClick={() => onSelectPoint(depLat, depLon)}
                className={`cursor-pointer border-b border-slate-100 text-slate-400 hover:bg-slate-50 ${
                  isSelected(depLat, depLon) ? "bg-blue-50" : ""
                }`}
              >
                <td className="px-2 py-1 text-left">{dep}</td>
                <td className="border-l border-slate-200 px-2 py-1">{altFt(depElevationFt)}</td>
                {Array.from({ length: 10 }, (_, i) => (
                  <td key={i} className="border-l border-slate-200 px-2 py-1">—</td>
                ))}
              </tr>
            )}
            {/* One row per waypoint the plan already knows about, not
                one per leg that's actually arrived -- `leg` is
                undefined until its own line streams in, and every cell
                that depends on it shows a dash rather than waiting. */}
            {waypoints.map(({ cp, name, lat, lon, leg }, i) => (
              <Fragment key={i}>
                {/* A leg with no nearby winds-aloft station is a
                    no-wind estimate, not a calm one. Shading keeps
                    that visible rather than letting it read as a
                    confident zero -- the same shade a leg that simply
                    hasn't arrived yet gets, for the same reason: both
                    are "no data (yet)," not a confident answer. */}
                <tr
                  ref={isSelected(lat, lon) ? selectedRef : undefined}
                  onClick={() => onSelectPoint(lat, lon)}
                  className={`cursor-pointer hover:bg-slate-50 ${cp && showDescriptions ? "" : "border-b border-slate-100"} ${
                    leg?.wind ? "" : "text-slate-400"
                  } ${isSelected(lat, lon) ? "bg-blue-50" : ""}`}
                >
                  <td className="px-2 py-1 text-left">{name}</td>
                  {/* The last row lands at the destination -- shows its
                      field elevation, known immediately, rather than
                      the cruise altitude every checkpoint before it
                      flies at (which isn't known until the "altitude"
                      message arrives, either -- hence `nav?.`). */}
                  <td className="border-l border-slate-200 px-2 py-1">
                    {altFt(cp ? nav?.altitude_ft : destElevationFt)}
                  </td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg ? leg.distance_nm.toFixed(1) : "—"}</td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg ? deg(leg.true_course_deg) : "—"}</td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg
                    ? (leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data")
                    : "—"}</td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg ? signed(leg.wca_deg) : "—"}</td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg ? deg(leg.true_heading_deg) : "—"}</td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg ? signed(leg.magnetic_variation_deg) : "—"}</td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg ? deg(leg.magnetic_heading_deg) : "—"}</td>
                  <td className="border-l border-slate-200 px-2 py-1">
                    {leg ? (leg.groundspeed_kt === null ? "—" : Math.round(leg.groundspeed_kt)) : "—"}
                  </td>
                  <td className="border-l border-slate-200 px-2 py-1">
                    {leg ? (leg.ete_min === null ? "unflyable" : one(leg.ete_min)) : "—"}
                  </td>
                  <td className="border-l border-slate-200 px-2 py-1">{leg ? one(leg.fuel_gal) : "—"}</td>
                </tr>
                {cp && showDescriptions && (
                  <tr className="border-b border-slate-100">
                    <td colSpan={12} className="bg-slate-50/60 px-2 py-1">
                      <DescriptionCell
                        description={descriptions[descriptionKey(cp.lat, cp.lon)]}
                        onSave={text => onSaveDescription(cp.lat, cp.lon, text)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
