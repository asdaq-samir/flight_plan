import { createPortal } from "react-dom";
import { format } from "date-fns";
import type { Briefing, Candidate, Course, Leg, NavLogAltitude, Totals } from "../../../lib/api/types";
import { kneeboardRadio, mhzText } from "../../../lib/frequencies";
import { pickedEnd, runwayFlown, runwayNumber } from "../../../lib/pattern";
import { useRunwayPicks } from "../../../lib/useRunwayPicks";
import { hm } from "../../../lib/clock";
import { routeName } from "../../../lib/identSchema";
import { altFt, gal, nm } from "../../../lib/units";
import { bearing, etaAt, one, plannedWords } from "../format";
import { isLegPoint, legOf, navLogRows, rowPoint } from "./navlog/rows";

/** The altitudes the legs fly: "4,500 ft", or "2,500-3,000 ft" where it steps. */
function altitudes(legs: Leg[], fallback: number | null | undefined): string | null {
  const alts = legs.map(l => l.altitude_ft);
  if (!alts.length) return fallback == null ? null : `${altFt(fallback)} ft`;
  const low = Math.min(...alts), high = Math.max(...alts);
  return low === high ? `${altFt(low)} ft` : `${altFt(low)}–${altFt(high)} ft`;
}

/** A line to write on: the label and a rule after it. */
function Blank({ label, wide = false }: { label: string; wide?: boolean }) {
  return (
    <span className="inline-flex items-end gap-1">
      <span>{label}</span>
      <span className={wide ? "inline-block w-28 border-b border-black" : "inline-block w-10 border-b border-black"} />
    </span>
  );
}

/**
 * The kneeboard card (the roadmap's kneeboard PDF): the flight on one
 * half-letter page to fly with -- the route, the airplane and the totals;
 * the nav log's legs, heading, distance, ground speed, time, fuel and ETA,
 * with ATA and fuel left to fill in; each field's radio and pattern, with
 * a line to copy its ATIS; and the special-use areas the route crosses.
 * Black on white whatever the theme. Never on screen: printKneeboard puts
 * it on paper in the briefing's place.
 */
export default function Kneeboard({ course, selected, legs, totals, nav, briefing, depart, aircraftLabel, landings }: {
  course: Course | null;
  selected: Candidate[];
  legs: Leg[];
  totals: Totals | null;
  nav: NavLogAltitude | null;
  briefing: Briefing | null;
  depart: string;
  aircraftLabel: string;
  /** The airports the flight lands at, in order. */
  landings: string[];
}) {
  const picks = useRunwayPicks();
  if (!course) return null;
  const rows = navLogRows(course, selected, legs);
  const special = nav?.altitude_selection.special_use ?? [];
  const tfrs = briefing?.tfrs.filter(t => t.crosses) ?? [];
  // As the route's box and a saved flight name it (routeName): a present
  // position by its coordinates, a local flight "KDLH local".
  const route = routeName(course.departure.ident, course.destination.ident, (course.stops ?? []).map(s => s.ident));
  return createPortal(
    <section className="kneeboard bg-white font-sans text-[8.5pt] leading-[1.25] text-black" aria-hidden data-testid="kneeboard">
      {/* A div, not a header: the page has one header, the panel's,
          which the layout's tests find by its element. */}
      <div className="mb-1.5 flex items-baseline justify-between border-b-2 border-black pb-1">
        <span className="text-[13pt] font-bold tracking-tight">{route}</span>
        <span>{depart ? format(new Date(depart), "EEE d MMM, HH:mm") : <Blank label="Date" />}</span>
      </div>
      <p className="mb-1.5">
        {aircraftLabel}
        {altitudes(legs, nav?.altitude_ft) && ` · ${altitudes(legs, nav?.altitude_ft)}`}
        {totals && ` · ${nm(totals.distance_nm)}`}
        {totals?.ete_min != null && ` · ${hm(totals.ete_min)}`}
        {totals?.fuel_gal != null && ` · ${gal(totals.fuel_gal)}`}
        {totals?.fuel_required_gal != null && ` (${one(totals.fuel_required_gal)} with reserve${totals.usable_fuel_gal != null ? `, ${one(totals.usable_fuel_gal)} usable` : ""})`}
        {/* Which winds the headings, times and fuel are from: a plan
            printed in the morning flown in the afternoon is not. */}
        {plannedWords(totals) && ` · ${plannedWords(totals)}`}
      </p>

      <table className="mb-2 w-full border-collapse tabular-nums [&_td]:border [&_td]:border-black/60 [&_td]:px-1 [&_td]:py-[1.5pt] [&_th]:border [&_th]:border-black [&_th]:px-1 [&_th]:py-[1pt] [&_th]:text-left [&_th]:text-[7.5pt]">
        <thead>
          <tr><th>Checkpoint</th><th>Alt</th><th>MH</th><th>Dist</th><th>GS</th><th>ETE</th><th>ETA</th><th className="w-9">ATA</th><th>Fuel</th><th className="w-9">Rem</th></tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const leg = legOf(r);
            const alt = isLegPoint(r) ? r.point.altitude_ft
              : r.kind === "checkpoint" || (r.kind === "stop" && r.airport.kind === "fix") ? (r.leg?.altitude_ft ?? nav?.altitude_ft) : r.airport.elevation_ft;
            return (
              <tr key={r.key} className={isLegPoint(r) ? "italic" : undefined}>
                <td className="max-w-[1.6in] truncate">{rowPoint(r).name}</td>
                <td>{altFt(alt)}</td>
                <td>{leg ? bearing(leg.magnetic_heading_deg) : ""}</td>
                <td>{leg ? one(leg.distance_nm) : ""}</td>
                <td>{leg?.groundspeed_kt != null ? Math.round(leg.groundspeed_kt) : ""}</td>
                <td>{leg ? one(leg.ete_min) : ""}</td>
                <td>{depart ? etaAt(depart, r.minutesFlown) : ""}</td>
                <td />
                <td>{leg ? one(leg.fuel_gal) : ""}</td>
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mb-2 grid grid-cols-2 gap-2">
        {landings.map((ident, i) => {
          const info = briefing?.airports[ident];
          // The runway flown there, the pilot's pick in FPL first: out of
          // the departure, into every other field.
          const inUse = info ? runwayFlown(info.runways, pickedEnd(picks, ident, i === 0 ? "takeoff" : "landing", i === 0)) : null;
          return (
            <div key={`${ident}${i}`} className="border border-black p-1">
              <p className="font-bold">{ident}{info?.name ? ` · ${info.name}` : ""}</p>
              <p>{info ? kneeboardRadio(info.frequencies).map(([name, mhz]) => `${name} ${mhzText(mhz)}`).join(" · ") || "No published radio" : ""}</p>
              {info?.pattern?.altitude_ft != null && (
                <p>
                  TPA {altFt(info.pattern.altitude_ft)}
                  {inUse && ` · Rwy ${runwayNumber(inUse.end.ident)} ${inUse.end.traffic}${inUse.byWind ? "" : " (no wind reported)"}`}
                  {info.elevation_ft != null && ` · elev ${altFt(info.elevation_ft)}`}
                </p>
              )}
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                <Blank label="Info" /><Blank label="Wind" /><Blank label="Alt" /><Blank label="Rwy" />
              </p>
            </div>
          );
        })}
      </div>

      {(special.length > 0 || tfrs.length > 0) && (
        <p className="mb-1.5">
          <span className="font-bold">On the route: </span>
          {[...special.map(a => `${a.name} (${a.kind})`), ...tfrs.map(t => `TFR ${t.notam_id}`)].join(" · ")}
        </p>
      )}
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        <Blank label="Squawk" /><Blank label="Clearance" wide /><Blank label="Hobbs out" /><Blank label="in" />
      </p>
      <p className="mt-2 text-[6.5pt]">Wingtip Maps · a planning aid: check the charts, NOTAMs and an official briefing before flight.</p>
    </section>,
    document.body,
  );
}
