import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_streamedQuery as streamedQuery, keepPreviousData, useMutation, useQuery, useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, describeError } from "../../../lib/api/client";
import { courseQuery, pilotQuery } from "../../../lib/queryClient";
import { routeOf } from "../../../lib/identSchema";
import { ended } from "../../../lib/api/streams";
import type {
  AircraftChoice, AltitudeChoice, Briefing, Leg, NarrativeMessage, NarrativeRequest, NavLogAltitude, NavLogMessage, Totals,
} from "../../../lib/api/types";
import { elapsed } from "../format";

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
 */

/** How to spot one checkpoint from the air. "saved" means a pilot's own
 *  earlier edit, not a fresh LLM generation; "error" means that one
 *  checkpoint's generation failed and `text` is empty, left for a
 *  pilot to fill in by hand -- keyed by lat/lon since that is how the
 *  server matches a checkpoint to its note too. */
export interface Description {
  text: string;
  source: "generated" | "saved" | "error";
}

export function descriptionKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export type Framework = "langgraph" | "crewai";

/** One framework's own narrative as it streams: the text so far (or
 *  the whole briefing once done), why there is none, and whether it
 *  is still being written. */
export interface FrameworkNarrative {
  text: string | null;
  error: string | null;
  loading: boolean;
}

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

/** A job id the planner answers 404 for: it restarted, and forgot. */
const vanished = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Where collecting the route on screen stands -- one value, where the
 *  page used to fold starting, running, failed and a failed start into
 *  one nullable string that was both the message and the busy flag. */
export type Build =
  | { phase: "idle" }
  | { phase: "needed" }
  | { phase: "starting" }
  | { phase: "queued"; detail: string }
  | { phase: "running"; progress: string }
  | { phase: "failed"; detail: string };

export function usePlan(
  { dep, dest, altitudeFt, altitudeChoice, depart, aircraft, load }: PlanParams,
) {
  const queryClient = useQueryClient();
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
  const messages = useMemo(() => navlog.data ?? [], [navlog.data]);
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

  // One "how to spot it" line per checkpoint, streamed on a pilot's
  // own click (the nav log's button) and never on its own: every line
  // is an LLM call. Once asked for, kept for the route.
  //
  // Keyed as the planner keeps them: per route and per pilot -- a
  // signed-in pilot's own edits are theirs alone, and after Log out the
  // next person must not see them -- and not per altitude, which the
  // request does not even send. The cache holds only what the stream
  // said; the pilot's own edits are the overlay below, never written
  // into it (writing a line in by hand made the query "fetched", and
  // Generate then did nothing for that route).
  const { data: pilot } = useQuery(pilotQuery);
  const pilotId = pilot?.id ?? null;
  const descriptions = useQuery({
    queryKey: ["descriptions", dep, dest, pilotId],
    queryFn: streamedQuery({
      streamFn: ({ signal }) => api.describeCheckpoints(dep, dest, signal),
    }),
    enabled: false, staleTime: Infinity,
  });
  const generateDescriptions = useCallback(() => {
    if (descriptions.isFetching || descriptions.isFetched) return;
    void descriptions.refetch();
  }, [descriptions]);

  // The pilot's own edits, shown the moment they are made: an overlay
  // on the stream, scoped the same way. Written when the save starts;
  // a failed save takes its own text back out -- but only if the box
  // still holds that text, so a later edit of the same checkpoint that
  // did save is never undone by an earlier one's failure.
  const scope = `${dep}\u0000${dest}\u0000${pilotId ?? ""}`;
  const [edits, setEdits] = useState<{ scope: string; notes: Record<string, string> }>({ scope, notes: {} });
  const descriptionMap = useMemo(() => {
    const map: Record<string, Description> = {};
    for (const m of descriptions.data ?? []) {
      if (m.type === "checkpoint") map[descriptionKey(m.lat, m.lon)] = { text: m.description ?? "", source: m.source };
    }
    if (edits.scope === scope) {
      for (const [key, text] of Object.entries(edits.notes)) map[key] = { text, source: "saved" };
    }
    return map;
  }, [descriptions.data, edits, scope]);
  const descriptionError = (descriptions.data ?? []).flatMap(m => (m.type === "error" ? [m.detail] : [])).at(-1) ?? null;
  const descriptionProgress = useMemo(() => {
    if (!descriptions.isFetching) return null;
    const started = (descriptions.data ?? []).find(m => m.type === "start");
    const done = (descriptions.data ?? []).filter(m => m.type === "checkpoint").length;
    return { done, total: started && started.type === "start" ? started.count : 0 };
  }, [descriptions.data, descriptions.isFetching]);

  const saveNote = useMutation({
    mutationFn: ({ lat, lon, text }: { lat: number; lon: number; text: string }) =>
      api.saveCheckpointNote(dep, dest, lat, lon, text),
    onMutate: ({ lat, lon, text }) => {
      const key = descriptionKey(lat, lon);
      setEdits(current => ({
        scope, notes: { ...(current.scope === scope ? current.notes : {}), [key]: text },
      }));
      return { scope, key, text };
    },
    onError: (_error, _vars, context) => {
      if (!context) return;
      setEdits(current => {
        if (current.scope !== context.scope || current.notes[context.key] !== context.text) return current;
        const { [context.key]: _failed, ...rest } = current.notes;
        return { scope: current.scope, notes: rest };
      });
    },
  });
  // The save's own promise, so the note's box can keep a pilot's typing
  // until it is safely saved (DescriptionCell).
  const saveDescription = useCallback(
    (lat: number, lon: number, text: string) => saveNote.mutateAsync({ lat, lon, text }),
    [saveNote],
  );

  // Each framework's narrative about the nav log on screen -- a
  // pilot's own click per framework, each a real, billed Claude call.
  // Only about a log that is flown: with no winds there are no legs.
  const narrativeRequest: NarrativeRequest | null = nav && nav.altitude_ft !== null ? {
    departure_ident: dep, destination_ident: dest, aircraft_name: nav.aircraft.name,
    altitude_ft: nav.altitude_ft, altitude_selection: nav.altitude_selection, legs,
  } : null;
  // The nav log's own key, not a few fields of it: this one left out the
  // departure time, the choice of plan, Load and the aeroplane's own
  // numbers, and held the leg count, which changes while legs stream --
  // so a narrative could be shown, or printed, beside a different log.
  const narrativeKey = (framework: Framework) => ["narrative", framework, ...planKey];
  const narrativeQuery = (framework: Framework) => ({
    queryKey: narrativeKey(framework),
    queryFn: streamedQuery({
      streamFn: ({ signal }: { signal: AbortSignal }) =>
        ended(api.frameworkNarrative(framework, narrativeRequest!, signal), `${framework} narrative`),
    }),
    enabled: false, staleTime: Infinity,
  });
  const langgraph = useQuery(narrativeQuery("langgraph"));
  const crewai = useQuery(narrativeQuery("crewai"));
  const narrativeOf = (query: typeof langgraph): FrameworkNarrative => {
    const chunks: NarrativeMessage[] = query.data ?? [];
    const done = chunks.find(m => m.type === "done");
    const text = done && done.type === "done" ? done.briefing : chunks.map(m => (m.type === "delta" ? m.text : "")).join("");
    return { text: text || null, error: query.error ? describeError(query.error) : null, loading: query.isFetching };
  };
  const generateNarrative = useCallback((framework: Framework) => {
    // Only a whole log: the request carries its legs, and a narrative of
    // half of them would be kept for this key as if it were the whole.
    if (!totals) { toast.error("The nav log isn't fully loaded yet."); return; }
    void (framework === "langgraph" ? langgraph : crewai).refetch();
  }, [totals, langgraph, crewai]);

  // Collecting a corridor nobody has collected: minutes of Overpass,
  // the FAA subscription and an elevation lookup per candidate, so the
  // planner queues a job to poll rather than holding the request open.
  // The job remembers its own route: its progress, its failure and its
  // "done" belong to that route, not whichever one is on screen when
  // they arrive.
  const [job, setJob] = useState<{ dep: string; dest: string; id: string; started: number } | null>(null);
  const startBuild = useMutation({
    mutationFn: (route: { dep: string; dest: string }) => api.startBuild(route.dep, route.dest),
    // The notice shows a failed start in place, with Collect to retry.
    meta: { silent: true },
    onSuccess: (started, route) => {
      if (started.state === "done" || !started.job_id) {
        void queryClient.invalidateQueries({ queryKey: ["checkpoints", route.dep, route.dest] });
      } else {
        setJob({ ...route, id: started.job_id, started: Date.now() });
      }
    },
  });
  const buildStatus = useQuery({
    queryKey: ["build", job?.id ?? null], queryFn: () => api.buildStatus(job!.id),
    enabled: !!job,
    refetchInterval: query => {
      // A job the planner no longer knows (it restarted) is not coming
      // back; any other failed poll is a blip, and polling goes on.
      if (vanished(query.state.error)) return false;
      const state = query.state.data?.state;
      return state === "done" || state === "failed" ? false : 2000;
    },
    meta: { silent: true },
  });
  useEffect(() => {
    if (!job || buildStatus.data?.state !== "done") return;
    // The job's own route's checkpoints asked for again, then the job
    // let go of -- in that order, so the notice stays up until the plan
    // has something.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["routes"] }),
      queryClient.invalidateQueries({ queryKey: ["checkpoints", job.dep, job.dest] }),
    ]).then(() => setJob(current => (current?.id === job.id ? null : current)));
  }, [buildStatus.data?.state, job, queryClient]);

  const build = ((): Build => {
    const jobHere = job && job.dep === dep && job.dest === dest ? job : null;
    const startedHere = startBuild.variables?.dep === dep && startBuild.variables?.dest === dest;
    if (!needsBuild && !jobHere) return { phase: "idle" };
    if (startBuild.isPending && startedHere) return { phase: "starting" };
    if (jobHere) {
      if (vanished(buildStatus.error)) {
        return { phase: "failed", detail: "the planner restarted before the collection finished" };
      }
      const status = buildStatus.data;
      if (!status) return { phase: "starting" };
      if (status.state === "failed") return { phase: "failed", detail: status.detail ?? "the collection failed" };
      if (status.state === "queued") return { phase: "queued", detail: status.step ?? "waiting for the builds ahead of it" };
      // The elapsed time as of the last poll (the query's own timestamp),
      // not the clock read during render.
      return { phase: "running", progress: `${status.step} — ${elapsed(buildStatus.dataUpdatedAt - jobHere.started)} elapsed` };
    }
    // A full queue is a 429 saying to come back: a failure to retry,
    // not a lock on the button until the page is reloaded.
    if (startBuild.isError && startedHere) return { phase: "failed", detail: describeError(startBuild.error, "could not start the collection") };
    return { phase: "needed" };
  })();

  return {
    course: course.data ?? null,
    candidates: checkpoints.data?.candidates ?? [],
    selected: checkpoints.data?.selected ?? [],
    legs, nav, totals, navStage, stage,
    sameAirport,
    build,
    collect: () => startBuild.mutate({ dep, dest }),
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
    descriptions: descriptionMap, descriptionError, descriptionProgress, generateDescriptions, saveDescription,
    langgraphNarrative: narrativeOf(langgraph),
    crewaiNarrative: narrativeOf(crewai),
    generateNarrative,
  };
}

function stripType<T extends { type: string }>(message: T): Omit<T, "type"> {
  const { type: _type, ...rest } = message;
  return rest;
}
