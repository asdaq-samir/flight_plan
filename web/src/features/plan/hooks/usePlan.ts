import { experimental_streamedQuery as streamedQuery, keepPreviousData, useQuery } from "@tanstack/react-query";
import { ApiError, api, describeError } from "../../../lib/api/client";
import { courseQuery } from "../../../lib/queryClient";
import { routeOf } from "../../../lib/identSchema";
import { ended } from "../../../lib/api/streams";
import type {
  AircraftChoice, AltitudeChoice, Briefing, Leg, NavLogAltitude, NavLogMessage, Totals,
} from "../../../lib/api/types";
import { useCheckpointNotes } from "./useCheckpointNotes";
import { useCorridorBuild } from "./useCorridorBuild";
import { useNarratives } from "./useNarratives";

/**
 * The plan as TanStack Query sees it: one query per stage, keyed on
 * what that stage depends on, so a change re-runs exactly the stages
 * it touches and nothing else. The course and its scored checkpoints
 * are chart-reading and a model inference over a fixed corridor --
 * the same answer today as an hour ago -- and are kept for the
 * session; the nav log is live winds and streams in leg by leg, keyed
 * on the aeroplane, the altitude and the departure time as well. The
 * briefing, the checkpoint descriptions and the two narratives are
 * asked for when a pilot opens or clicks for them. Every failure is
 * the query client's to report (queryClient.ts), except the one the
 * page can do something about: a route nobody has collected yet.
 *
 * Checkpoint notes, the two narratives and collecting a route are hooks
 * of their own (useCheckpointNotes, useNarratives, useCorridorBuild),
 * which this one composes into the page's one plan: each changes for
 * its own reasons, and this file used to change for all of them.
 */

export interface PlanParams {
  dep: string;
  dest: string;
  /** The pilot's own cruise altitude, or "" for the planner's plan. */
  altitudeFt: string;
  altitudeChoice: AltitudeChoice;
  /** The departure time as an ISO instant, or "" for about now. */
  depart: string;
  aircraft: AircraftChoice;
  /** Load pressed again for the same route: a fresh nav log, fresh winds. */
  load: number;
}

/** Whether a checkpoints failure is the one the page can fix itself:
 *  the corridor exists, nobody has collected it yet. Only the
 *  checkpoints can say so -- they are what the model scores; the course
 *  only resolves the two airports, and charts any route at all. */
const notCollected = (error: unknown) =>
  error instanceof ApiError && error.status === 404 && error.message.includes("not been collected");

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

export function usePlan(
  { dep, dest, altitudeFt, altitudeChoice, depart, aircraft, load }: PlanParams,
) {
  const routeKnown = routeOf(dep, dest) !== null;
  // The form will not submit a route from an airport to itself, but the
  // address can hold one -- a pasted link, an edited URL, a back button
  // to a half-typed state. Nothing is fetched for it, so without this
  // the page sat blank: no chart, no message, nothing to press.
  const sameAirport = !!dep && dep === dest;

  // The previous route's course stays on the map until the new one is
  // charted, so the map is never taken down between routes.
  const course = useQuery({ ...courseQuery(dep, dest), enabled: routeKnown, placeholderData: keepPreviousData });

  const checkpoints = useQuery({
    queryKey: ["checkpoints", dep, dest], queryFn: () => api.checkpoints(dep, dest),
    // routeKnown as well as the course: a disabled course query still
    // hands back the previous route's course as placeholder data.
    enabled: routeKnown && !!course.data, staleTime: Infinity, meta: { silent: notCollected },
  });
  const needsBuild = notCollected(checkpoints.error);

  // Everything the nav log is computed from -- the narratives below are
  // keyed on the same, so a narrative is always about the log on screen.
  const planKey = [
    dep, dest, altitudeFt, altitudeChoice, depart, load,
    aircraft.profile, aircraft.cruiseTasKt ?? null, aircraft.fuelBurnGph ?? null, aircraft.usableFuelGal ?? null,
  ];
  const navlog = useQuery({
    queryKey: ["navlog", ...planKey],
    queryFn: streamedQuery({
      streamFn: ({ signal }) => ended(
        api.navlog(dep, dest, altitudeFt || undefined, aircraft, altitudeChoice, depart || undefined, signal), "nav log",
      ),
    }),
    enabled: !!checkpoints.data, staleTime: Infinity,
  });
  const messages = navlog.data ?? [];
  // Each message narrowed by its own `type`, not cast: the "altitude"
  // line was cast to a hand-written copy of its shape, whose comments had
  // gone stale while the cast kept compiling.
  const legs = messages.flatMap((m): Leg[] => (m.type === "leg" ? [stripType(m)] : []));
  const altitude = messages.find((m): m is Extract<NavLogMessage, { type: "altitude" }> => m.type === "altitude");
  const nav: NavLogAltitude | null = altitude ? stripType(altitude) : null;
  const done = messages.find(m => m.type === "done");
  const totals: Totals | null = done && done.type === "done" ? done.totals : null;
  const stages = messages.filter(m => m.type === "stage");
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
  const eteMin = totals?.ete_min ?? undefined;
  const briefing = useQuery({
    queryKey: ["briefing", dep, dest, depart, eteMin ?? null, load],
    queryFn: () => api.briefing(dep, dest, depart || undefined, eteMin),
    enabled: !!course.data, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const notes = useCheckpointNotes(dep, dest);
  const narratives = useNarratives({ dep, dest, planKey, nav, legs, whole: !!totals });
  const { build, collect } = useCorridorBuild(dep, dest, needsBuild);

  return {
    course: course.data ?? null,
    candidates: checkpoints.data?.candidates ?? [],
    selected: checkpoints.data?.selected ?? [],
    legs, nav, totals, navStage, stage,
    sameAirport,
    build,
    collect,
    briefing: ((): BriefingState => {
      if (!course.data) return { state: "waiting" };
      if (briefing.data) {
        return {
          state: "ready", data: briefing.data, fetchedAt: briefing.dataUpdatedAt,
          refreshError: briefing.error ? describeError(briefing.error, "could not refresh the briefing") : null,
        };
      }
      if (briefing.error) return { state: "failed", detail: describeError(briefing.error, "could not load the briefing") };
      return { state: "loading" };
    })(),
    ...notes,
    ...narratives,
  };
}

function stripType<T extends { type: string }>(message: T): Omit<T, "type"> {
  const { type: _type, ...rest } = message;
  return rest;
}
