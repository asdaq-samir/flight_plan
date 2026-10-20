import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import { usePrinting } from "../../../../lib/usePrinting";
import { TEXT } from "../../../../lib/text";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import type { Briefing, Course, Leg } from "../../../../lib/api/types";
import { pirepConditions } from "../../../../lib/advisories";
import { distanceNm } from "../../../../lib/geo";
import { categoryOf } from "../../../../lib/map/flightCategory";
import { passTime } from "../../../../lib/passTimes";
import { altFt, ceilingAndVisibility, clockTime, windLine } from "../../format";
import CategoryBadge from "./CategoryBadge";
import Observed from "../../../../components/Observed";
import { phasesOf, type Phase } from "./sections";
import { FINDING_TONE } from "../../../../lib/status";

type Station = Briefing["forecast"]["stations"][number];
type Pirep = Briefing["pireps"][number];

/** How far from a field without a TAF of its own a neighbour's is named
 *  for it. A TAF is for 5 sm round its own airport (FAA-H-8083-28,
 *  Aviation Weather Handbook), so a neighbour's is not this field's
 *  forecast, and the row says whose it is and how far; past this, none
 *  is offered. The planner's own choice. */
const NEAREST_TAF_NM = 25;

interface Place {
  ident: string;
  role: string;
  lat: number;
  lon: number;
  alongNm: number;
}

/** Each airport the flight takes off from or lands at, how far along the
 *  route: the course's points one after another, as the briefing placed
 *  its stations along them. */
function placesOf(course: Course): Place[] {
  const points = [course.departure, ...(course.stops ?? []), course.destination];
  // A local flight, one field to itself, is one place.
  if (points.length === 2 && points[0]!.ident === points[1]!.ident) {
    const p = points[0]!;
    return [{ ident: p.ident, role: "Local", lat: p.lat, lon: p.lon, alongNm: 0 }];
  }
  let along = 0;
  return points.flatMap((p, i) => {
    if (i > 0) along += distanceNm(points[i - 1]!, p);
    if (p.kind === "fix") return [];
    const role = i === 0 ? "Departure" : i === points.length - 1 ? "Destination" : "Stop";
    return [{ ident: p.ident, role, lat: p.lat, lon: p.lon, alongNm: along }];
  });
}

/** A field's own TAF: the station by its ident, or its ICAO one (KDLH
 *  for DLH). */
const ownStation = (stations: Station[], ident: string) =>
  stations.find(s => s.icaoId === ident || (ident.length === 3 && s.icaoId === `K${ident}`));

/** A line's first letter capitalised: the figures open a row's line. */
const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** A METAR's figures past its wind, in words, as FAA Order JO 7900.5
 *  codes them and the planner reads them: the ceiling and the visibility
 *  (ceilingAndVisibility), the temperature and dew point (°C), and the
 *  altimeter setting (inHg). */
function metarFigures(metar: NonNullable<Briefing["metars"][string]>): string {
  // Below zero with the minus sign, not a hyphen (M02 is −2).
  const degrees = (c: number) => `${Math.round(c) < 0 ? "−" : ""}${Math.abs(Math.round(c))}`;
  return [
    sentence(ceilingAndVisibility(metar.ceiling_ft, metar.visibility_sm)),
    metar.temp_c != null && `${degrees(metar.temp_c)} °C${metar.dewpoint_c != null ? `, dew point ${degrees(metar.dewpoint_c)}` : ""}`,
    metar.altimeter_in_hg != null && `${metar.altimeter_in_hg.toFixed(2)} inHg`,
  ].filter(Boolean).join(" · ");
}

/** A TAF read for when the flight is there, in words: its ceiling and
 *  visibility then, or that it says nothing about then. */
const atEta = (station: Station) => (station.eta_ceiling_ft == null && station.eta_visibility_sm == null
  ? "Nothing forecast for then"
  : sentence(ceilingAndVisibility(station.eta_ceiling_ft, station.eta_visibility_sm)));

const categoryAt = (station: Station) => categoryOf(station.eta_ceiling_ft, station.eta_visibility_sm);

function PirepRow({ p }: { p: Pirep }) {
  return (
    <ListRow
      title={(
        <span className={cn(p.urgent && cn("font-semibold", FINDING_TONE.stop))}>
          {[p.urgent ? "Urgent PIREP" : "PIREP", p.altitude_ft != null && `${altFt(p.altitude_ft)} ft`, p.aircraft].filter(Boolean).join(" · ")}
        </span>
      )}
      description={(
        <>
          {pirepConditions(p) && <span className="block">{pirepConditions(p)}</span>}
          {p.raw && <span className="block font-mono whitespace-pre-wrap">{p.raw}</span>}
        </>
      )}
      value={`${Math.round(p.along_track_nm)} nm`}
      data-testid="pirep"
    />
  );
}

type Run = { kind: "pirep"; along: number; pirep: Pirep } | { kind: "tafs"; along: number; stations: Station[] };

/** What lies along a stretch, in order, with consecutive TAFs that are
 *  VFR when the flight passes run together; a pilot report, or a TAF
 *  that is not VFR then, breaks a run. */
function runs(items: { along: number; station: Station | null; pirep: Pirep | null }[]): Run[] {
  const out: Run[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (item.pirep) out.push({ kind: "pirep", along: item.along, pirep: item.pirep });
    else if (categoryAt(item.station!) === "VFR" && last?.kind === "tafs" && categoryAt(last.stations[0]!) === "VFR") last.stations.push(item.station!);
    else out.push({ kind: "tafs", along: item.along, stations: [item.station!] });
  }
  return out;
}

/**
 * The weather place by place, in the order the flight meets it: each
 * airport it leaves or lands at -- its report now and its forecast for
 * when the flight is there -- and between them the TAFs near the route,
 * each read for when the flight passes, and the pilot reports, each
 * where it was made. It was four lists by kind (current conditions, the
 * destination's forecast, the forecasts en route worst first, the pilot
 * reports), each read against the whole flight; a pilot reads a route
 * from one end to the other.
 */
export default function WeatherAlongRoute({ briefing, course, legs, departIso, unchecked, phase }: {
  briefing: Briefing;
  /** Only this part of the flight's (its tab's): the departure's weather,
   *  the stretches and stops between, or the destination's. */
  phase?: Phase;
  course: Course;
  legs: Leg[];
  /** The departure time, ISO: the time picked, or now. */
  departIso: string;
  unchecked: (source: Briefing["weather_unavailable"][number]) => boolean;
}) {
  const printing = usePrinting();
  const places = placesOf(course);
  const stations = briefing.forecast.stations;
  const own = new Map(places.map(p => [p.ident, ownStation(stations, p.ident)]));
  const owned = new Set([...own.values()].filter(Boolean).map(s => s!.icaoId));
  const enRoute = stations.filter(s => !owned.has(s.icaoId) && s.along_track_nm != null);
  const pireps = unchecked("pireps") ? [] : briefing.pireps;
  const at = (alongNm: number) => passTime(legs, departIso, alongNm);
  const when = (date: Date | null) => (date ? clockTime(date) : null);

  // What lies between one place and the next, in order along the route.
  const between = (from: number, to: number, last: boolean) => [
    ...enRoute.filter(s => s.along_track_nm! >= from && (last ? true : s.along_track_nm! < to)).map(s => ({ along: s.along_track_nm!, station: s, pirep: null })),
    ...pireps.filter(p => p.along_track_nm >= from && (last ? true : p.along_track_nm < to)).map(p => ({ along: p.along_track_nm, station: null, pirep: p })),
  ].sort((a, b) => a.along - b.along);

  return (
    // A field's weather under its own tab's title, Weather; the way between
    // Along the Route.
    <AccordionSection title={phase === "depart" || phase === "arrive" ? "Weather" : "Along the Route"}>
      <div className="space-y-4" data-testid="weather-places" data-tip="weather-places">
        {places.map((place, i) => {
          const metar = briefing.metars[place.ident];
          const station = own.get(place.ident);
          const nearest = station ? null : stations
            .map(s => ({ s, nm: s.lat != null && s.lon != null ? distanceNm(place, { lat: s.lat, lon: s.lon }) : Infinity }))
            .filter(x => x.nm <= NEAREST_TAF_NM)
            .sort((a, b) => a.nm - b.nm)[0];
          const eta = (station ?? nearest?.s)?.eta ? new Date((station ?? nearest!.s).eta!) : at(place.alongNm);
          const next = places[i + 1];
          const stretch = next ? between(place.alongNm, next.alongNm, i === places.length - 2) : [];
          // The place's own weather on its phase's tab, the stretch after it
          // on En route's.
          const placeShown = !phase || phasesOf(i, places.length).includes(phase);
          const stretchShown = !phase || phase === "enroute";
          return (
            <Fragment key={`${place.ident}${i}`}>
              {/* On its phase's tab the field's ident alone: the tab says
                  whether it is the departure or the destination, and the
                  section under says it again (the owner's notice of
                  "C81 · DEPARTURE" three times on Depart). Its flight
                  category is its report's, on the report's row: beside the
                  ident as well, it was said twice (each fact once, the
                  owner's pick of the redesign). */}
              {placeShown && <ListGroup title={phase === "depart" || phase === "arrive" ? place.ident : `${place.ident} · ${place.role}`}>
                {unchecked("metars") ? (
                  <ListRow title="Now" description={<span className="text-amber-700 dark:text-amber-300">Not checked: aviationweather.gov did not answer</span>} />
                ) : (
                  // The report in words first, at the owner's pick of the
                  // redesign: the wind, then the rest; as sent, a tap away
                  // (below).
                  <ListRow
                    title={metar?.raw ? `Now · wind ${windLine(metar).replace(/^(Calm|Variable|Not)/, w => w.toLowerCase())}` : "Now"}
                    // When it was observed under the figures, amber past 90
                    // minutes, as the map's card says it: the planner holds
                    // a report up to 3 hours when aviationweather.gov does
                    // not answer, and the go/no-go is made here.
                    description={metar?.raw ? (
                      <>
                        <span className="block">{metarFigures(metar)}</span>
                        {metar.observed_at && <Observed at={metar.observed_at} className="block" />}
                      </>
                    ) : "No current report"}
                    data-testid="place-metar"
                  >
                    <CategoryBadge category={metar?.flight_category} />
                  </ListRow>
                )}
                {unchecked("forecast") ? (
                  <ListRow title="Forecast" description={<span className="text-amber-700 dark:text-amber-300">Not checked: aviationweather.gov did not answer</span>} />
                ) : station ?? nearest ? (
                  // The figures first, a line to themselves, then whose TAF
                  // it is and the TAF as issued, the whole row's width: with
                  // the figures at the row's end the TAF's text was ten
                  // characters a line.
                  <ListRow
                    title={`Forecast${when(eta) ? `, ${when(eta)}` : ""}`}
                    description={(
                      <>
                        <span className="block text-foreground">{atEta((station ?? nearest!.s))}</span>
                        {!station && <span className="block">{`No TAF here: ${nearest!.s.icaoId}'s, ${Math.round(nearest!.nm)} nm away`}</span>}
                      </>
                    )}
                    data-testid="place-taf"
                  >
                    <CategoryBadge category={categoryAt(station ?? nearest!.s)} />
                  </ListRow>
                ) : (
                  <ListRow title="Forecast" description={`No TAF here or within ${NEAREST_TAF_NM} nm`} data-testid="place-taf" />
                )}
                {/* The reports as sent, a tap away; on paper, with them. */}
                {(metar?.raw || station?.raw) && (
                  <Collapsible open={printing || undefined} data-testid="place-raw">
                    <CollapsibleTrigger className={cn("group flex w-full items-center justify-between px-4 py-3 text-left text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden", TEXT.row)}>
                      <span>{metar?.raw && station?.raw ? "METAR and TAF" : metar?.raw ? "METAR" : "TAF"}</span>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" aria-hidden />
                    </CollapsibleTrigger>
                    <CollapsibleContent className={cn("space-y-2 px-4 pb-3 font-mono whitespace-pre-wrap text-muted-foreground", TEXT.note)}>
                      {metar?.raw && <p>{metar.raw}</p>}
                      {station?.raw && <p>{station.raw}</p>}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </ListGroup>}
              {next && stretchShown && (
                <ListGroup title={places.length > 2 ? `${place.ident} to ${next.ident}` : "En route"}>
                  {stretch.length === 0 ? (
                    <ListRow title={<span className="text-muted-foreground">No TAFs or pilot reports near this stretch</span>} />
                  ) : runs(stretch).map(run => run.kind === "pirep" ? (
                    <PirepRow key={`p${run.along}${run.pirep.raw}`} p={run.pirep} />
                  ) : run.stations.length > 1 ? (
                    // A run of TAFs all VFR when the flight passes is one row:
                    // twenty rows of "no ceiling · 6 sm" hid the one that was not.
                    <ListRow
                      key={`v${run.stations[0]!.icaoId}`}
                      title={`${run.stations.length} TAFs, VFR at each`}
                      description={`${run.stations.map(st => st.icaoId).join(", ")} · ${Math.round(run.stations[0]!.along_track_nm!)}–${Math.round(run.stations.at(-1)!.along_track_nm!)} nm along`}
                      data-testid="enroute-vfr"
                    >
                      <CategoryBadge category="VFR" />
                    </ListRow>
                  ) : (
                    <ListRow
                      key={`s${run.stations[0]!.icaoId}`} title={run.stations[0]!.icaoId}
                      description={[atEta(run.stations[0]!), `${Math.round(run.along)} nm along`, run.stations[0]!.eta && `about ${clockTime(new Date(run.stations[0]!.eta))}`].filter(Boolean).join(" · ")}
                      data-testid="enroute-taf"
                    >
                      <CategoryBadge category={categoryAt(run.stations[0]!)} />
                    </ListRow>
                  ))}
                </ListGroup>
              )}
            </Fragment>
          );
        })}
        {/* Each TAF read for an hour either side of when the flight gets
            there, TEMPO and PROB groups included: the worst it allows then;
            pilot reports from the last 90 minutes, where they were made. */}
      </div>
    </AccordionSection>
  );
}
