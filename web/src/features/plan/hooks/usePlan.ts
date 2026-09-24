import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_streamedQuery as streamedQuery, keepPreviousData, useMutation, useQuery, useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, describeError } from "../../../lib/api/client";
import { ended } from "../../../lib/api/streams";
import type {
  AircraftChoice, AltitudeChoice, CheckpointDescriptionMessage, Leg, NarrativeMessage, NavLog, Totals,
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

export function usePlan(
  { dep, dest, altitudeFt, altitudeChoice, depart, aircraft, load }: PlanParams,
) {
  const queryClient = useQueryClient();
  const routeKnown = !!dep && !!dest && dep !== dest;
  // The form will not submit a route from an airport to itself, but the
  // address can hold one -- a pasted link, an edited URL, a back button
  // to a half-typed state. Nothing is fetched for it, so without this
  // the page sat blank: no chart, no message, nothing to press.
  const sameAirport = !!dep && dep === dest;

  // The previous route's course stays on the map until the new one is
  // charted, so the map is never taken down between routes.
  const course = useQuery({
    queryKey: ["course", dep, dest], queryFn: () => api.course(dep, dest),
    enabled: routeKnown, staleTime: Infinity, placeholderData: keepPreviousData,
  });

  const checkpoints = useQuery({
    queryKey: ["checkpoints", dep, dest], queryFn: () => api.checkpoints(dep, dest),
    enabled: !!course.data, staleTime: Infinity, meta: { silent: notCollected },
  });
  const needsBuild = notCollected(checkpoints.error);

  const navlog = useQuery({
    queryKey: [
      "navlog", dep, dest, altitudeFt, altitudeChoice, depart, load,
      aircraft.profile, aircraft.cruiseTasKt ?? null, aircraft.fuelBurnGph ?? null, aircraft.usableFuelGal ?? null,
    ],
    queryFn: streamedQuery({
      streamFn: ({ signal }) => ended(
        api.navlog(dep, dest, altitudeFt || undefined, aircraft, altitudeChoice, depart || undefined, signal), "nav log",
      ),
    }),
    enabled: !!checkpoints.data, staleTime: Infinity,
  });
  const messages = useMemo(() => navlog.data ?? [], [navlog.data]);
  const legs = useMemo(() => messages.flatMap(m => (m.type === "leg" ? [stripType(m) as Leg] : [])), [messages]);
  const nav = useMemo<Omit<NavLog, "legs" | "totals"> | null>(() => {
    const altitude = messages.find(m => m.type === "altitude");
    return altitude ? (stripType(altitude) as Omit<NavLog, "legs" | "totals">) : null;
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
  const descriptionsKey = ["descriptions", dep, dest, altitudeFt];
  const descriptions = useQuery({
    queryKey: descriptionsKey,
    queryFn: streamedQuery({
      streamFn: ({ signal }) => api.describeCheckpoints(dep, dest, signal),
    }),
    enabled: false, staleTime: Infinity,
  });
  const generateDescriptions = useCallback(() => {
    if (descriptions.isFetching || descriptions.isFetched) return;
    void descriptions.refetch();
  }, [descriptions]);
  const descriptionMap = useMemo(() => {
    const map: Record<string, Description> = {};
    for (const m of descriptions.data ?? []) {
      if (m.type === "checkpoint") map[descriptionKey(m.lat, m.lon)] = { text: m.description ?? "", source: m.source };
    }
    return map;
  }, [descriptions.data]);
  const descriptionError = (descriptions.data ?? []).flatMap(m => (m.type === "error" ? [m.detail] : [])).at(-1) ?? null;
  const descriptionProgress = useMemo(() => {
    if (!descriptions.isFetching) return null;
    const started = (descriptions.data ?? []).find(m => m.type === "start");
    const done = (descriptions.data ?? []).filter(m => m.type === "checkpoint").length;
    return { done, total: started && started.type === "start" ? started.count : 0 };
  }, [descriptions.data, descriptions.isFetching]);

  // A pilot's own edit, shown at once and put back if the save fails.
  const saveNote = useMutation({
    mutationFn: ({ lat, lon, text }: { lat: number; lon: number; text: string }) =>
      api.saveCheckpointNote(dep, dest, lat, lon, text),
    onMutate: ({ lat, lon, text }) => {
      const previous = queryClient.getQueryData<CheckpointDescriptionMessage[]>(descriptionsKey);
      queryClient.setQueryData<CheckpointDescriptionMessage[]>(descriptionsKey, old => [
        ...(old ?? []),
        { type: "checkpoint", lat, lon, description: text, source: "saved" } as CheckpointDescriptionMessage,
      ]);
      return { previous };
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(descriptionsKey, context?.previous),
  });
  const saveDescription = useCallback(
    (lat: number, lon: number, text: string) => saveNote.mutate({ lat, lon, text }),
    [saveNote],
  );

  // Each framework's narrative about the nav log on screen -- a
  // pilot's own click per framework, each a real, billed Claude call.
  const narrativeRequest = nav && {
    departure_ident: dep, destination_ident: dest, aircraft_name: nav.aircraft.name,
    altitude_ft: nav.altitude_ft, altitude_selection: nav.altitude_selection, legs,
  };
  const narrativeKey = (framework: Framework) =>
    ["narrative", framework, dep, dest, nav?.altitude_ft ?? null, nav?.aircraft.name ?? null, legs.length];
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
    if (!nav) { toast.error("The nav log isn't fully loaded yet."); return; }
    void (framework === "langgraph" ? langgraph : crewai).refetch();
  }, [nav, langgraph, crewai]);

  // Collecting a corridor nobody has collected: minutes of Overpass,
  // the FAA subscription and an elevation lookup per candidate, so
  // the planner returns a job to poll rather than holding the request
  // open; done, the checkpoints -- the query that said "not collected"
  // -- are asked for again.
  const [job, setJob] = useState<{ id: string; started: number } | null>(null);
  const startBuild = useMutation({
    mutationFn: () => api.startBuild(dep, dest),
    onSuccess: started => {
      if (started.state === "done" || !started.job_id) {
        void queryClient.invalidateQueries({ queryKey: ["checkpoints", dep, dest] });
      } else {
        setJob({ id: started.job_id, started: Date.now() });
      }
    },
  });
  const buildStatus = useQuery({
    queryKey: ["build", job?.id ?? null], queryFn: () => api.buildStatus(job!.id),
    enabled: !!job,
    refetchInterval: query => {
      const state = query.state.data?.state;
      return state === "done" || state === "failed" ? false : 2000;
    },
    meta: { silent: true },   // a transient blip should not abandon a running job
  });
  useEffect(() => {
    if (buildStatus.data?.state !== "done") return;
    // The checkpoints asked for again, then the job let go of -- in
    // that order, so the notice stays up until the plan has something.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["routes"] }),
      queryClient.invalidateQueries({ queryKey: ["checkpoints", dep, dest] }),
    ]).then(() => setJob(null));
  }, [buildStatus.data?.state, queryClient, dep, dest]);
  // The elapsed time as of the last poll (the query's own timestamp),
  // not the clock read during render.
  const building = startBuild.isPending
    ? "starting…"
    : job
      ? buildStatus.data
        ? buildStatus.data.state === "failed"
          ? buildStatus.data.detail ?? "build failed"
          : `${buildStatus.data.step} — ${elapsed(buildStatus.dataUpdatedAt - job.started)} elapsed`
        : "starting…"
      : startBuild.error
        ? describeError(startBuild.error, "build failed")
        : null;

  return {
    course: course.data ?? null,
    candidates: checkpoints.data?.candidates ?? [],
    selected: checkpoints.data?.selected ?? [],
    legs, nav, totals, navStage, stage,
    needsBuild: needsBuild ? { dep, dest } : null,
    sameAirport,
    building,
    build: () => startBuild.mutate(),
    briefing: briefing.data ?? null,
    briefingError: briefing.error ? describeError(briefing.error, "could not load the briefing") : null,
    loadingBriefing: briefing.isLoading,
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
