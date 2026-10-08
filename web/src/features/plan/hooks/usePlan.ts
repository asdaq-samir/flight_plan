import { useEffect, useMemo, useState } from "react";
import { experimental_streamedQuery as streamedQuery, keepPreviousData, useQuery } from "@tanstack/react-query";
import { ApiError, api, describeError } from "../../../lib/api/client";
import { checkpointsQuery, courseQuery } from "../../../lib/queryClient";
import { identOf, routeOf } from "../../../lib/identSchema";
import { ended } from "../../../lib/api/streams";
import type {
  AircraftChoice, AltitudeChoice, Briefing, Candidate, Detour, Leg, NavLogAltitude, NavLogMessage, Totals,
} from "../../../lib/api/types";
import { useCheckpointNotes } from "./useCheckpointNotes";
import { useNarratives } from "./useNarratives";

/**
 * The plan as TanStack Query sees it: one query per stage, keyed on
 * what that stage depends on, so a change re-runs exactly the stages
 * it touches and nothing else. The course and its scored checkpoints
 * are chart-reading and a model inference over a fixed corridor --
 * the same answer today as an hour ago -- and are kept for the
 * session; the nav log is live winds and streams in leg by leg, keyed
 * on the airplane, the altitude and the departure time as well. The
 * briefing, the checkpoint descriptions and the two narratives are
 * asked for when a pilot opens or clicks for them. Every failure is
 * the query client's to report (queryClient.ts). A route had first to
 * be collected, which the page offered; its checkpoints come off the
 * chart now, for any route it covers.
 *
 * Checkpoint notes and the two narratives are hooks of their own
 * (useCheckpointNotes, useNarratives),
 * which this one composes into the page's one plan: each changes for
 * its own reasons, and this file used to change for all of them.
 */

/** No plan has a legal altitude: the planner's headline (where along the
 *  route), its reasons, and what to do (app.planning.no_altitude). */
export interface Unflyable {
  title: string;
  /** All of it in a few words, for the one line under the route. */
  brief: string;
  reasons: string[];
  advice: string | null;
  /** Class B airspace is what stops it: a clearance, or a waypoint to
   *  fly via -- `detours`, the ones round it, best first -- are the ways on. */
  classB: boolean;
  detours: Detour[];
}

export interface PlanParams {
  dep: string;
  dest: string;
  /** The airports landed at on the way, in order: [] for a route flown
   *  straight. */
  stops: string[];
  /** The pilot's own cruise altitude, or "" for the planner's plan. */
  altitudeFt: string;
  altitudeChoice: AltitudeChoice;
  /** The departure time as an ISO instant, or "" for about now. */
  depart: string;
  aircraft: AircraftChoice;
  /** Load pressed again for the same route: a fresh nav log, fresh winds. */
  load: number;
  /** The pilot will have a Class B clearance: planned through it. */
  classBClearance?: boolean;
  /** Points' own altitudes, as the address has them ("VPBNG:4500,KMSN:1900"):
   *  a waypoint's flown to it, an airport's its pattern (RouteBox). */
  altitudes?: string;
  /** Checkpoints between the route's points, as the map shows them (the
   *  settings' Waypoints): without, the nav log runs point to point and
   *  none are asked for. */
  checkpoints?: boolean;
  /** A local flight's time aloft, in minutes (one airport to itself). */
  localMin?: number;
}

/** Where the route's briefing stands -- one value, read by the map's
 *  airport chips and the drawer alike. It used to be three (the data,
 *  the error, whether it was loading), which each reader combined its
 *  own way: after a failed five-minute refresh the map greyed the two
 *  airports out as unavailable while the drawer showed the same METARs
 *  as current with nothing to say the refresh had failed. Now both show
 *  the last briefing, with when it was fetched and that a refresh
 *  failed. "waiting" is a briefing with no course yet to ask about --
 *  it read "Loading…" for ever when the course failed. */
export type BriefingState =
  | { state: "waiting" }
  | { state: "loading" }
  | { state: "ready"; data: Briefing; fetchedAt: number; refreshError: string | null }
  | { state: "failed"; detail: string };

/** How long the checkpoints' nav log may go without legs before the
 *  route as entered is asked for beside it: longer than a planned route
 *  takes to answer (0.1 s), much shorter than a new one's chart read (3
 *  to 6 s) -- which no longer slows the planner's other answers, being
 *  read in a process of its own (app.chart_model). */
const AS_ENTERED_AFTER_MS = 600;

// No checkpoints, one array for good: a new [] at every render was a new
// list to everything drawn from it, the nav log's rows and its profile
// chart drawn again at every render of the page.
const NONE: Candidate[] = [];

/** Everything the nav log is computed from -- the narratives are keyed
 *  on the same, so a narrative is always about the log on screen. */
function planKeyOf(
  { dep, dest, stops, altitudeFt, altitudeChoice, depart, aircraft, load, classBClearance = false, altitudes = "", checkpoints = true }: PlanParams,
) {
  return [
    dep, dest, stops.join(","), altitudeFt, altitudeChoice, depart, load, classBClearance, altitudes, checkpoints,
    aircraft.profile, aircraft.cruiseTasKt ?? null, aircraft.fuelBurnGph ?? null, aircraft.usableFuelGal ?? null,
    aircraft.climbTasKt ?? null, aircraft.climbFuelBurnGph ?? null, aircraft.cruisePowerPct ?? null,
  ];
}

/** A plan's nav log, with its checkpoints or point to point: the page's
 *  own (usePlan), and Fly Here's, asked for at the tap before the page
 *  has drawn the route (PlanWorkspace). */
export function navlogQuery(plan: PlanParams, checkpointsToo: boolean) {
  const { dep, dest, stops, altitudeFt, altitudeChoice, depart, aircraft, classBClearance = false, altitudes = "" } = plan;
  const planKey = planKeyOf(plan);
  return {
    // The same key as the checkpoints' with them off, so the route as
    // entered and a plan with Waypoints off are one answer.
    queryKey: ["navlog", ...planKey.slice(0, 9), checkpointsToo, ...planKey.slice(10)],
    queryFn: streamedQuery({
      streamFn: ({ signal }: { signal: AbortSignal }) => ended(
        api.navlog(dep, dest, altitudeFt || undefined, aircraft, altitudeChoice, depart || undefined, signal, stops, classBClearance, altitudes, checkpointsToo),
        "nav log",
      ),
    }),
    staleTime: Infinity,
    // No legal altitude is the page's to say, with what can be done about
    // it (PlanWorkspace): not the query client's plain toast.
    meta: { silent: (error: unknown) => error instanceof ApiError && error.advice !== null },
  };
}

export function usePlan(
  {
    dep, dest, stops, altitudeFt, altitudeChoice, depart, aircraft, load, classBClearance = false, altitudes = "",
    checkpoints: withCheckpoints = true, localMin = 60,
  }: PlanParams,
) {
  const routeKnown = routeOf(dep, dest, stops) !== null;
  // An airport to itself with no stop between: a local flight -- the
  // pattern, practice approaches. No course or legs to plan; the field's
  // briefing, and the time aloft with its fuel check (localFlight). It
  // was refused, the page asking for two different airports.
  const local = !!identOf(dep) && dep === dest && stops.length === 0;
  const briefable = routeKnown || local;
  const via = stops.join(",");

  // The previous route's course stays on the map until the new one is
  // charted, so the map is never taken down between routes.
  const course = useQuery({ ...courseQuery(dep, dest, stops), enabled: briefable, placeholderData: keepPreviousData });
  const localFlight = useQuery({
    queryKey: ["localFlight", dep, localMin, depart, aircraft.profile, aircraft.fuelBurnGph ?? null, aircraft.usableFuelGal ?? null],
    queryFn: () => api.localFlight(dep, localMin, aircraft, depart || undefined),
    enabled: local, placeholderData: keepPreviousData,
  });

  // Asked for with the course, not after it, and the nav log with them
  // both, at the pilot's ask for a fast route to nav log: each waited on
  // the one before, three round trips in a row, where the planner works
  // out the checkpoints for the nav log itself (and once for both:
  // app.scoring) -- and starts on the chart's read and the ground under
  // the route as the course is asked for (app.prefetch).
  const checkpoints = useQuery({ ...checkpointsQuery(dep, dest, stops), enabled: routeKnown && withCheckpoints });

  const plan = {
    dep, dest, stops, altitudeFt, altitudeChoice, depart, aircraft, load, classBClearance, altitudes, checkpoints: withCheckpoints,
  };
  const planKey = planKeyOf(plan);
  const navlog = useQuery({ ...navlogQuery(plan, withCheckpoints), enabled: routeKnown });
  const fullIn = (navlog.data ?? []).some(m => m.type === "leg" || m.type === "done") || !!navlog.error;
  // The route as entered first, point to point, at the pilot's ask for a
  // fast route to nav log: no chart read before it, so its legs are in a
  // second or two -- and the checkpoints' nav log in its place as soon as
  // its own legs come. Asked for only once the checkpoints' has been a
  // moment without legs (a route new to the planner): one it has planned
  // before answers in a tenth of a second, and asking for both doubled
  // the planner's work on every route. And once the course has answered,
  // as it says (Course.checkpoints_ready): at once where the chart along
  // the route is still to be read, not at all where it is -- the wait
  // was 0.6 s on every new route, and a planned one asked for both all
  // the same when the course came after it (measured at a phone's speed,
  // 2026-10-07).
  const routeId = planKey.join("|");
  const [slowFor, setSlowFor] = useState<string | null>(null);
  useEffect(() => {
    if (!routeKnown || !withCheckpoints || fullIn) return;
    const timer = window.setTimeout(() => setSlowFor(routeId), AS_ENTERED_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [routeId, routeKnown, withCheckpoints, fullIn]);
  const ready = course.isPlaceholderData ? undefined : course.data?.checkpoints_ready;
  const asEntered = useQuery({
    ...navlogQuery(plan, false), enabled: routeKnown && withCheckpoints && !fullIn && (ready === undefined ? slowFor === routeId : !ready),
  });
  const pointToPoint = withCheckpoints && !fullIn && !!asEntered.data?.some(m => m.type === "leg");
  const messages = useMemo(
    () => (pointToPoint ? asEntered.data : navlog.data) ?? [], [pointToPoint, asEntered.data, navlog.data]);
  // Each message narrowed by its own `type`, not cast: the "altitude"
  // line was cast to a hand-written copy of its shape, whose comments had
  // gone stale while the cast kept compiling.
  const legs = useMemo(() => messages.flatMap((m): Leg[] => (m.type === "leg" ? [stripType(m)] : [])), [messages]);
  const nav = useMemo<NavLogAltitude | null>(() => {
    const altitude = messages.find((m): m is Extract<NavLogMessage, { type: "altitude" }> => m.type === "altitude");
    return altitude ? stripType(altitude) : null;
  }, [messages]);
  const totals = useMemo<Totals | null>(() => {
    const done = messages.find(m => m.type === "done");
    return done && done.type === "done" ? done.totals : null;
  }, [messages]);
  const unflyable = useMemo<Unflyable | null>(() => {
    const error = navlog.error;
    return error instanceof ApiError && error.advice !== null
      ? {
        title: error.message, brief: error.brief ?? "No legal altitude", reasons: error.reasons, advice: error.advice,
        classB: error.classB, detours: error.detours,
      } : null;
  }, [navlog.error]);
  // What the checkpoints' nav log is working on, while it is, over the
  // route as entered too.
  const stages = (navlog.data ?? []).filter(m => m.type === "stage");
  const navStage = navlog.isFetching ? (stages.at(-1) as { detail?: string } | undefined)?.detail ?? null : null;

  // Which stage is outstanding, for the progress toast.
  const stage: "course" | "checkpoints" | "navlog" | null =
    course.isLoading ? "course" : checkpoints.isLoading ? "checkpoints" : navlog.isFetching ? "navlog" : null;

  // The briefing's own data -- hazards, METAR, forecast, runways and
  // frequencies. Fetched as soon as the course is, not only once a
  // pilot opens the drawer that shows it -- the map's own departure
  // and destination markers read its METARs too, the same as a Class
  // B airport reads one, so it can't wait on that drawer opening.
  //
  // And asked again every five minutes while the page is open and in
  // front of the pilot. Being always enabled took away the refetch the
  // drawer used to get each time it opened; with refetch-on-focus off
  // app-wide, the briefing then stayed whatever it was when the route
  // loaded, for as long as the page stayed up. `load` is in the key for
  // the same reason as the nav log's: Load again means fresh weather.
  //
  // Its forecast is for the flight -- from the departure time to past
  // arrival -- so it is asked again once the nav log's totals give the
  // ETE; the previous answer stays up meanwhile, so the map's chips do
  // not flash back to "checking".
  const eteMin = (local ? localMin : totals?.ete_min) ?? undefined;
  const briefing = useQuery({
    queryKey: ["briefing", dep, dest, via, depart, eteMin ?? null, load],
    // Given up when the route changes, as the checkpoints are (checkpointsQuery).
    queryFn: ({ signal }) => api.briefing(dep, dest, depart || undefined, eteMin, stops, signal),
    // Not on the previous route's placeholder course once the route is
    // closed: asked for two empty idents, it toasted "Airport identifier
    // '' not found".
    enabled: briefable && !!course.data, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  // The same object while the briefing is: a new one at every render drew
  // every tab of the panel again with it.
  const hasCourse = !!course.data;
  const briefingState = useMemo((): BriefingState => {
    if (!briefable || !hasCourse) return { state: "waiting" };
    if (briefing.data) {
      return {
        state: "ready", data: briefing.data, fetchedAt: briefing.dataUpdatedAt,
        refreshError: briefing.error ? describeError(briefing.error, "could not refresh the briefing") : null,
      };
    }
    if (briefing.error) return { state: "failed", detail: describeError(briefing.error, "could not load the briefing") };
    return { state: "loading" };
  }, [briefable, hasCourse, briefing.data, briefing.dataUpdatedAt, briefing.error]);

  const notes = useCheckpointNotes(dep, dest, stops);
  // Written from the checkpoints' nav log, not the route as entered.
  const narratives = useNarratives({ dep, dest, planKey, nav, legs, whole: !!totals && !pointToPoint });

  return {
    // Not the previous route's, kept as a placeholder, once the route is
    // closed (the capsule's X): the map is the chart alone then.
    course: briefable ? course.data ?? null : null,
    candidates: withCheckpoints ? checkpoints.data?.candidates ?? NONE : NONE,
    selected: withCheckpoints ? checkpoints.data?.selected ?? NONE : NONE,
    // The nav log's own rows' checkpoints: none while it is the route as
    // entered, whose legs run point to point.
    logSelected: withCheckpoints && !pointToPoint ? checkpoints.data?.selected ?? NONE : NONE,
    legs, nav, navStage, stage, unflyable,
    // The nav log on screen is the route as entered, its checkpoints' own
    // still to come in its place.
    pointToPoint,
    totals: local ? localFlight.data ?? null : totals,
    local,
    briefing: briefingState,
    ...notes,
    ...narratives,
  };
}

function stripType<T extends { type: string }>(message: T): Omit<T, "type"> {
  const { type: _type, ...rest } = message;
  return rest;
}
