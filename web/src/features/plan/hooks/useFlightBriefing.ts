import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { aircraftListQuery, currencyQuery, pilotQuery } from "../../../lib/queryClient";
import type { Briefing, Course, Leg, NavLogAltitude, Totals } from "../../../lib/api/types";
import type { BriefingState } from "./usePlan";
import { ceilingAndVisibility, PLAN_NAME, reportedWind } from "../format";
import { feetRange, flightLevel, grouped } from "../../../lib/units";
import { isAirwayToken } from "../../../lib/identSchema";
import { useLoad } from "./useLoad";
import { armText } from "../../../lib/weightBalance";
import { underMinimums } from "../../../lib/minimums";
import { usePreferences } from "../../../lib/preferences";
import { faaWords, gairmetTitle, sigmetHazard, suaAltitudes } from "../../../lib/advisories";
import { passTime, suaWhen, tfrWhen, type SuaWhen } from "../../../lib/passTimes";
import { pickedEnd, runwayFlown, runwayNumber } from "../../../lib/pattern";
import { useRunwayPicks } from "../../../lib/useRunwayPicks";
import { runwayChecks } from "../../../lib/runwayCheck";
import { worstOf } from "../../../lib/status";
import { useVerdict, verdictItems, type VerdictItem } from "../../../lib/verdict";
import { callSign, fieldPhases } from "../../../lib/radio";
import { useGlance, type BriefGlance, type FieldGlance } from "../../../lib/glance";
import { shortName } from "../../../lib/aircraftChoice";
import { usePrinting } from "../../../lib/usePrinting";
import { fieldCategory } from "../components/briefing/fieldWeather";
import { flightPlanForms, type FiledProcedure } from "../../../lib/flightPlanForm";
import { alternateFinding, useAlternate } from "./useAlternate";
import { icingAtAltitude, icingLine } from "../../../lib/icing";
import { planFacts } from "../../../lib/oral";
import { assess, riskLine, useRisk } from "../../../lib/frat";
import type { BriefingPart } from "../components/briefing/sections";

/** What each weather source is called when a pilot is told it could
 *  not be checked. */
export const WEATHER_SOURCE_LABEL: Record<Briefing["weather_unavailable"][number], string> = {
  hazards: "SIGMETs",
  forecast: "the TAF forecast",
  metars: "current METARs",
  tfrs: "TFRs",
  pireps: "pilot reports",
  gairmets: "G-AIRMETs",
};

export interface Stretch {
  from: string;
  to: string;
  altitudeFt: number;
  wind: { dir: number; speed: number } | null;
  /** The forecast temperature there, whole degrees; null where none was
   *  near (a standard day was flown). */
  oatC: number | null;
}

/** Consecutive legs flown in the same wind and temperature at the same
 *  altitude, as one stretch of the route: many legs share their nearest
 *  winds-aloft station, and so report the same forecast. From the nav
 *  log's own per-leg winds and temperatures -- a summary of what it
 *  already fetched, not a second call. */
export function windStretches(legs: Leg[]): Stretch[] {
  const stretches: Stretch[] = [];
  for (const leg of legs) {
    const wind = leg.wind ? { dir: Math.round(leg.wind.wind_dir_true_deg), speed: Math.round(leg.wind.wind_speed_kt) } : null;
    const oatC = leg.oat_c == null ? null : Math.round(leg.oat_c);
    const last = stretches[stretches.length - 1];
    const same = last && last.altitudeFt === leg.altitude_ft && last.oatC === oatC
      && (last.wind === null ? wind === null : wind !== null && last.wind.dir === wind.dir && last.wind.speed === wind.speed);
    if (same) last.to = leg.to;
    else stretches.push({ from: leg.from, to: leg.to, altitudeFt: leg.altitude_ft, wind, oatC });
  }
  return stretches;
}

/** The altitudes a plan flies as the nav log's header gives them: one
 *  figure, or its lowest and highest. */
export function altitudeRange(nav: NavLogAltitude): string {
  const chosen = nav.options.find(o => o.kind === nav.flown);
  const alts = chosen ? chosen.steps.map(s => s.altitude_ft) : nav.altitude_ft != null ? [nav.altitude_ft] : [];
  if (alts.length === 0) return "No altitude";
  return feetRange(alts);
}

const NO_STOPS: string[] = [];

export interface FlightBriefingInputs {
  /** Which of the panel's tabs this is drawn in (FlightBriefingView). */
  part: BriefingPart | null;
  /** The one instance that publishes the risk, the findings and the glance. */
  publish?: boolean;
  nav: NavLogAltitude | null;
  legs: Leg[];
  dep: string;
  dest: string;
  stops?: string[];
  route?: string[];
  procedures?: { departure: FiledProcedure | null; arrival: FiledProcedure | null };
  course?: Course | null;
  totals?: Totals | null;
  depart?: string;
  briefing: BriefingState;
  problem?: string | null;
}

/**
 * The briefing's view model (FlightBriefingView): what each part of the
 * briefing reads, worked out from the plan and the briefing fetched, and
 * the risk assessment, the Go / No-Go's findings and the Brief's glance
 * published by the one instance outside the tabs (`publish`).
 */
export function useFlightBriefing({
  part, publish = false, nav, legs, dep, dest, stops = NO_STOPS, route = NO_STOPS, procedures, course = null, totals = null, depart = "",
  briefing: briefingState, problem = null,
}: FlightBriefingInputs) {
  // The load's weights, for the takeoff and landing distances.
  const { loading, load, result: loaded } = useLoad(nav?.aircraft, totals?.fuel_gal ?? null);
  // The runways the pilot picked in FPL, flown in the oral's facts and
  // checked for length (runwayFlown).
  const picks = useRunwayPicks();
  // Every airport the flight lands at, each once: a round trip's
  // departure is its destination.
  const landings = [...new Set([dep, ...stops, dest])];
  const stretches = windStretches(legs);
  // "VFR flight not recommended" (AIM 7-1-5) and its reasons are the
  // planner's call (wingtip.weather), made against 14 CFR 91.155's minimums
  // in one place; this page states them.
  const briefing = briefingState.state === "ready" ? briefingState.data : null;
  const failed = briefingState.state === "failed" ? briefingState.detail : null;
  // Under IFR "VFR flight not recommended" is no reason not to go: its
  // weather check is the destination's and the alternate's (14 CFR
  // 91.169), not VFR's minimums.
  const ifr = usePreferences(p => p.flightRules) === "ifr";
  const vnrReasons = ifr ? [] : briefing?.vfr_not_recommended ?? [];
  const briefingPendingMessage =
    briefingState.state === "waiting" ? "The briefing follows once the route's course is drawn."
      : failed ? `Briefing data is unavailable (${failed}).`
        : "Fetching METARs, forecasts, hazards, runways and frequencies…";
  const unchecked = (source: Briefing["weather_unavailable"][number]) => briefing?.weather_unavailable.includes(source) ?? false;

  const chosen = nav?.options.find(o => o.kind === nav.flown);
  // Where the weather is under the pilot's own minimums (lib/minimums).
  const minimums = usePreferences(s => s.minimums);
  const underMine = briefing ? underMinimums(minimums, briefing, landings, dest) : [];
  // When the flight passes a point along the route: from the departure
  // picked, or from now, the time the page was opened, for "Now".
  const [opened] = useState(() => new Date().toISOString());
  const passAt = (alongNm: number) => passTime(legs, depart || opened, alongNm);
  // The TFRs the route goes through while they are in force: in force
  // when the flight gets there (half an hour either way) -- the planner's
  // word on it where it placed the TFR on the legs (on_route) -- or at
  // some time during the flight where that time is not known yet.
  const tfrInForce = (t: Briefing["tfrs"][number]) => {
    if (t.on_route?.when) return t.on_route.when === "during";
    const pass = passAt(t.along_track_nm);
    return !pass || tfrWhen(t, pass) === "in-force";
  };
  const tfrsCrossed = briefing?.tfrs.filter(t => t.crosses && tfrInForce(t)) ?? [];
  // The special-use areas the legs cross (wingtip.sua, with the altitudes),
  // and their times of use read for when the flight passes each, in the
  // area's own time zone.
  const specialUse = (nav?.altitude_selection.special_use ?? []).map(area => {
    const pass = passAt(area.along_track_nm);
    return { area, pass, when: pass ? suaWhen(area.times_of_use, pass, area.time_zone) : "unknown" as SuaWhen };
  });
  // The call sign the radio calls use: the pilot's own airplane's
  // registration where they fly one, and its make from its profile.
  const flying = usePreferences(s => s.aircraft);
  const make = nav?.aircraft.type?.split(" ")[0] || "Airplane";
  const ownCallSign = callSign(make, flying.aircraftId != null ? shortName(flying.label) : null);
  // The risk assessment (lib/frat): the briefing's, the nav log's and the
  // logbook's factors, and what the pilot ticks. Published for the Save
  // button, which files it with the flight.
  const { data: pilot } = useQuery(pilotQuery);
  const { data: currency } = useQuery({ ...currencyQuery, enabled: !!pilot });
  // The pilot's own airplane being flown, for its inspections and, under
  // IFR, its VOR check.
  const flyingId = usePreferences(p => p.aircraft.aircraftId);
  const { data: ownAircraft } = useQuery({ ...aircraftListQuery, enabled: !!pilot && flyingId != null });
  const flownOwn = flyingId == null ? undefined : ownAircraft?.find(a => a.id === flyingId);
  const ticked = useRisk(s => s.ticked);
  const setAssessment = useRisk(s => s.setAssessment);
  const margins = [totals?.fuel_margin_gal, ...(totals?.hops ?? []).map(h => h.totals.fuel_margin_gal)]
    .filter((n): n is number => n != null);
  // The least margin of the route's flights: one figure, for the risk
  // assessment, the Go / No-Go's fuel and the glance alike.
  const leastMarginGal = margins.length ? Math.min(...margins) : null;
  // Under IFR, in cloud at or above the freezing level (lib/icing).
  const icing = ifr && nav && briefing ? icingAtAltitude(nav.altitude_selection, legs.map(l => l.altitude_ft), briefing.pireps) : null;
  const hazardNames = briefing ? [...briefing.hazards.map(h => sigmetHazard(h.hazard, h.type ?? "SIGMET")), ...briefing.gairmets.map(gairmetTitle)] : [];
  const assessment = briefing ? assess({
    vfrNotRecommended: vnrReasons.length > 0,
    underMinimums: underMine,
    tfrOnRoute: tfrsCrossed.length > 0,
    hazards: unchecked("hazards") && unchecked("gairmets") ? 0 : hazardNames.length,
    night: totals?.night === true,
    fuelMarginGal: leastMarginGal,
    ifr,
    vorCheck: flownOwn === undefined ? undefined : flownOwn.vorCheck
      ? { goodThrough: flownOwn.vorCheck.goodThrough, withinLimit: flownOwn.vorCheck.withinLimit } : null,
    inspections: flownOwn?.inspections,
    squawks: flownOwn?.openSquawks,
    currency: currency ?? null,
    day: format(new Date(depart || opened), "yyyy-MM-dd"),
    ticked,
  }) : null;
  const destStation = briefing?.forecast.stations.find(st => st.icaoId === dest);
  // The flight in plain lines, for the mock oral's examiner (lib/oral):
  // what the briefing already holds.
  const planText = briefing ? planFacts({
    route: landings.filter(i => briefing.airports[i]).map(i => {
      const a = briefing.airports[i]!;
      const picked = pickedEnd(picks, i, i === dep ? "takeoff" : "landing", i === dep);
      const inUse = runwayFlown(a.runways, picked);
      return { ident: i, name: a.name, airspaceClass: a.airspace_class, patternFt: a.pattern?.altitude_ft, runway: inUse && (picked || inUse.byWind) ? runwayNumber(inUse.end.ident) : null };
    }),
    aircraft: nav?.aircraft.type ?? nav?.aircraft.name, cruiseFt: nav?.altitude_ft,
    distanceNm: totals?.distance_nm ?? course?.distance_nm, eteMin: totals?.ete_min, fuelGal: totals?.fuel_gal,
    reserveMin: totals?.reserve_min, night: totals?.night,
    depart: depart ? format(new Date(depart), "EEE d MMM, HH:mm") : null,
    metars: landings.flatMap(i => (briefing.metars[i]?.raw ? [{ ident: i, raw: briefing.metars[i]!.raw! }] : [])),
    destinationForecast: destStation ? ceilingAndVisibility(destStation.ceiling_ft, destStation.visibility_sm) : null,
    hazards: hazardNames,
    specialUse: specialUse.map(({ area }) => `${faaWords(area.name)} (${area.kind}), ${suaAltitudes(area)}`),
    tfrs: briefing.tfrs.length,
  }) : "";
  const assessmentKey = assessment ? `${assessment.level}:${assessment.score}:${assessment.factors.map(f => f.key).join(",")}` : "";
  useEffect(() => {
    if (publish) setAssessment(assessment);
    // Keyed on what it says, not the object made each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentKey, setAssessment, publish]);
  useEffect(() => () => { if (publish) setAssessment(null); }, [setAssessment, publish]);

  // The runway check at each field (lib/runwayCheck), for the
  // Performance tab and the Go / No-Go.
  const checks = runwayChecks(nav?.aircraft, briefing, course, loaded?.takeoff.weightLb ?? null, loaded?.landing.weightLb ?? null, picks);
  const hops = totals?.hops ?? [];
  // Under IFR, the alternate (AlternateSection): its ETA the nav log's.
  const etaIso = totals?.ete_min != null ? new Date(new Date(depart || opened).getTime() + totals.ete_min * 60_000).toISOString() : null;
  const alternateWhere = { dest, eta: ifr ? etaIso : null, tasKt: nav?.aircraft.cruise_tas_kt ?? 110 };
  const alternateCheck = useAlternate(alternateWhere);
  const alternateFound = ifr ? alternateFinding(alternateCheck.data) : null;
  const verdictFound: VerdictItem[] = verdictItems({
    weather: {
      pending: !briefing && !failed, failed,
      vfrNotRecommended: vnrReasons, underMinimums: underMine, icing: icing && icingLine(icing), hazards: hazardNames,
      unchecked: (briefing?.weather_unavailable ?? []).filter(w => w !== "tfrs").map(w => WEATHER_SOURCE_LABEL[w]),
      worst: briefing && (briefing.forecast.min_ceiling_ft != null || briefing.forecast.min_visibility_sm != null)
        ? ceilingAndVisibility(briefing.forecast.min_ceiling_ft, briefing.forecast.min_visibility_sm) : null,
    },
    airspace: {
      pending: !briefing && !failed, unchecked: !!failed || unchecked("tfrs"),
      inForce: tfrsCrossed.map(t => t.notam_id), near: (briefing?.tfrs.length ?? 0) - tfrsCrossed.length,
      specialUse: specialUse.map(({ area, when }) => ({ name: area.name, when })),
    },
    altitude: {
      pending: !nav, problem,
      cautions: nav?.cautions.flatMap(c => c.reasons) ?? [],
      flown: !nav ? null : nav.flown === "custom" ? `${flightLevel(nav.altitude_ft)}, your own` : `${altitudeRange(nav)}${chosen ? ` · ${PLAN_NAME[chosen.kind]} plan` : ""}`,
    },
    fuel: {
      pending: !totals,
      marginGal: leastMarginGal,
      requiredGal: totals?.fuel_required_gal ?? (hops.length ? Math.max(...hops.map(h => h.totals.fuel_required_gal ?? 0)) : null),
      reserveMin: totals?.reserve_min ?? hops[0]?.totals.reserve_min ?? null,
      ifr,
    },
    runways: {
      pending: !nav || !briefing, worked: !nav || (!!nav.aircraft.takeoff && !!nav.aircraft.landing),
      short: [...new Set(checks.filter(c => c.distances.some(d => d.over)).map(c => c.field.ident))],
      crosswind: [...new Set(checks.filter(c => c.crosswindOver).map(c => c.field.ident))],
      beyond: [...new Set(checks.filter(c => c.distances.some(d => d.beyond)).map(c => c.field.ident))],
      unchecked: [...new Set(checks.filter(c => c.unchecked || c.distances.some(d => d.unknown)).map(c => c.field.ident))],
    },
    balance: {
      pending: !nav, worked: !!loading && !!loaded,
      problems: loaded?.problems ?? [],
      takeoff: loaded ? `${grouped(loaded.takeoff.weightLb)} lb at ${armText(loaded.takeoff)}` : null,
    },
    risk: assessment ? { level: assessment.level, line: riskLine(assessment) } : null,
  });
  // Published once, for the tabs' marks (PlanWorkspace), as the risk is.
  const setItems = useVerdict(v => v.setItems);
  // The alternate is the weather's to say, where the weather says nothing
  // worse: a caution or a stop of its own, opening its section.
  const items: VerdictItem[] = alternateFound
    ? verdictFound.map(i => (i.key === "weather" && (i.finding === "ok" || (alternateFound.finding === "stop" && i.finding !== "stop"))
      ? { ...i, ...alternateFound, tab: "arrive", section: "Alternate" } : i))
    : verdictFound;
  const itemsKey = items.map(i => `${i.key}:${i.finding}:${i.detail}`).join("|");
  useEffect(() => {
    if (publish) setItems(items);
    // Keyed on what they say, not the array made each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, setItems, publish]);
  useEffect(() => () => { if (publish) setItems([]); }, [setItems, publish]);

  // The Brief's glance (lib/glance): each part of the flight in a few
  // figures, from what the pages say -- the runway checks, the radio's
  // first call, the forecast at each field and along the way -- published
  // by the one instance outside the pages, as the findings are.
  const glance: BriefGlance | null = publish ? (() => {
    const leaving = new Date(depart || opened);
    const fieldAt = (ident: string, kind: "departure" | "arrival", at: Date | null): FieldGlance => {
      const check = checks.find(c => c.field.ident === ident && (kind === "departure" ? c.role === "Departure" : c.role === "Destination"));
      const distance = check?.distances.find(d => d.kind === (kind === "departure" ? "takeoff" : "landing"));
      const metar = briefing?.metars[ident];
      const said = metar ? reportedWind(metar.wind_dir_true_deg ?? null, metar.wind_speed_kt ?? null, metar.wind_gust_kt ?? null) : null;
      const phase = briefing ? fieldPhases(briefing, landings, legs, ownCallSign, ident, picks).find(p => p.kind === kind) : undefined;
      const call = phase?.calls.find(c => c.mhz != null);
      return {
        ident,
        category: briefing && course ? fieldCategory(briefing, course, ident) : null,
        at: at ? at.toISOString() : null,
        runway: check?.end ? runwayNumber(check.end) : null,
        runwayFt: check?.runway?.length_ft ?? null,
        overFiftyFt: distance ? Math.round(distance.totalFt) : null,
        wind: said === "calm" ? "Calm" : said ? `${said.dir.replace(/T$/, "")}/${said.speed}` : null,
        crosswindKt: check ? Math.round(check.crosswindKt) : null,
        radio: call ? { to: call.to, mhz: call.mhz! } : null,
        // A field not checked (no elevation, no runway length) is not known,
        // never fine; one past the POH's tables is a caution (the engine's
        // runways finding says the same).
        finding: !check || check.unchecked || !distance || distance.unknown ? "unknown" : distance.over ? "stop"
          : check.crosswindOver || distance.beyond ? "caution" : "ok",
      };
    };
    const byKey = (keys: VerdictItem["key"][]) => worstOf(items.filter(i => keys.includes(i.key)).map(i => i.finding));
    const wind = stretches[0]?.wind;
    return {
      before: {
        risk: assessment ? { score: assessment.score, level: assessment.level } : null,
        spareGal: leastMarginGal,
        balance: loaded ? { within: loaded.problems.length === 0, problem: loaded.problems[0] ?? null } : null,
        finding: byKey(["risk", "fuel", "balance", "airspace"]),
      },
      depart: course ? fieldAt(dep, "departure", leaving) : null,
      enroute: {
        ceilingFt: briefing?.forecast.min_ceiling_ft ?? null,
        visibilitySm: briefing?.forecast.min_visibility_sm ?? null,
        wind: wind ? `${String(wind.dir).padStart(3, "0")}°/${wind.speed}` : null,
        eteMin: totals?.ete_min ?? null,
        line: items.find(i => i.key === "weather")?.detail ?? null,
        finding: byKey(["weather", "altitude"]),
      },
      arrive: course ? fieldAt(dest, "arrival", totals?.ete_min != null ? new Date(leaving.getTime() + totals.ete_min * 60_000) : null) : null,
      // The reports as sent, for a finding's sources under its line.
      raw: {
        metars: landings.flatMap(i => (briefing?.metars[i]?.raw ? [{ ident: i, raw: briefing.metars[i]!.raw! }] : [])),
        tafs: landings.flatMap(i => {
          const st = briefing?.forecast.stations.find(s => s.icaoId === i);
          return st?.raw ? [{ ident: i, raw: st.raw }] : [];
        }),
        tfrs: (briefing?.tfrs ?? []).map(t => [t.notam_id, t.title].filter(Boolean).join(" · ")),
      },
    };
  })() : null;
  const setGlance = useGlance(g => g.set);
  const glanceKey = glance ? JSON.stringify(glance) : "";
  useEffect(() => {
    if (publish) setGlance(glance);
    // Keyed on what it says, not the object made each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glanceKey, setGlance, publish]);
  useEffect(() => () => { if (publish) setGlance(null); }, [setGlance, publish]);

  // Preflight's sections a tile opens and the paperwork, folded on screen
  // under the checks (BriefChecks), each opened by its tile or a tap on
  // its title; on paper, laid open.
  const printing = usePrinting();
  const [folds, setFolds] = useState<string[]>([]);

  // The flight plan's airplane: the pilot's own by its registration and
  // the type designator they gave it, or a stock profile's type; item 9's
  // wake category from the profile's maximum takeoff weight only where
  // the profile is that type's. Worked out only for Preflight, which
  // shows the forms.
  const ownType = flying.aircraftId != null ? flying.label.split(" · ")[1] ?? null : null;
  const profileType = nav?.aircraft.designator ?? null;
  const planType = flying.aircraftId != null ? ownType : profileType;
  const planForms = part === "preflight" ? flightPlanForms({
    rules: ifr ? "ifr" : "vfr", dep, dest, route, landings: stops,
    isAirway: stop => isAirwayToken(stop) && !course?.stops?.some(s => s.ident === stop),
    legs, totals, depart: depart ? new Date(depart) : null, now: new Date(opened),
    aircraft: {
      ident: flying.aircraftId != null ? shortName(flying.label) : null,
      type: planType,
      maxTakeoffLb: planType && planType === profileType ? nav?.aircraft.loading?.max_takeoff_lb ?? null : null,
      // Items 10 and 19's colour, from the pilot's own airplane's page.
      equipment: flownOwn?.equipment ?? null, surveillance: flownOwn?.surveillance ?? null, colour: flownOwn?.colour ?? null,
    },
    // Item 19's pilot in command, from their own page (Pilot details, in Setup).
    pilot: pilot ? { name: pilot.fullName ?? null, phone: pilot.phone ?? null, homeBase: pilot.homeBase ?? null } : null,
    fuelGal: load?.fuelGal ?? null,
    alternate: totals?.alternate?.ident ?? null,
    departureProcedure: procedures?.departure, arrivalProcedure: procedures?.arrival,
  }) : [];

  return {
    briefing, ifr, vnrReasons, briefingPendingMessage, unchecked, underMine, opened, passAt, tfrInForce, tfrsCrossed,
    specialUse, landings, stretches, ownCallSign, pilot, assessment, icing, hazardNames, planText, loaded, items,
    alternateWhere, printing, folds, setFolds, planForms,
  };
}

/** The briefing's view model, as its parts read it. */
export type FlightBriefing = ReturnType<typeof useFlightBriefing>;
