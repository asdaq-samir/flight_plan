import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../../lib/api/client";
import type { Briefing, BuiltRoute, Candidate, Course, Leg, NavLog, Totals } from "../../../lib/api/types";
import { elapsed } from "../format";

/**
 * The planner's state.
 *
 * Shaped around the fact that a plan arrives in three stages of very
 * different cost -- the course in well under a second, the scored
 * checkpoints shortly after, the nav log only once terrain, airspace and
 * live winds have been read. Each stage lands in its own field and the
 * view renders whatever is there, so the map is drawn while the rest is
 * still outstanding and a slow nav log never holds up the chart.
 *
 * `navError` is deliberately separate from `error`: the nav log failing
 * is not the plan failing, and it should not clear a map that is already
 * correct.
 *
 * This used to be a zustand store (`create<PlanState>(...)`). Rolled
 * back to a plain hook -- see "Learning this from zero" in
 * web/README.md for when a dependency like that is worth bringing back.
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

interface PlanState {
  course: Course | null;
  candidates: Candidate[];
  selected: Candidate[];
  legs: Leg[];
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  descriptions: Record<string, Description>;
  /** A failure that applies to every checkpoint the same way (a bad
   *  key, an exhausted rate limit) -- separate from a per-checkpoint
   *  failure, which lives inline in `descriptions` instead. */
  descriptionError: string | null;
  /** How far the description stream has gotten -- the status popup's
   *  own "Generating 12/21," not tracked anywhere else. */
  descriptionProgress: { done: number; total: number } | null;

  routes: BuiltRoute[];
  /** Which stage is outstanding, for the header. Null when settled. */
  stage: "course" | "checkpoints" | "navlog" | null;
  /** What the nav log stream is doing right now (scoring, altitude
   *  selection, the live aviationweather.gov fetch) -- null once it's
   *  settled, same as `stage`, and not meaningful until `stage` is
   *  actually "navlog". */
  navStage: string | null;
  error: string | null;
  navError: string | null;
  /** Set when the corridor has never been collected: the one error the
   *  page can offer to fix rather than just report. */
  needsBuild: { dep: string; dest: string } | null;
  building: string | null;

  /** Whichever waypoint (departure, a checkpoint, or the destination)
   *  is currently focused -- by its own coordinates, not a row index
   *  into any particular list, since the map's markers and the nav
   *  log's rows are two independent orderings of the same points and
   *  an index into one means nothing in the other. */
  selectedPoint: { lat: number; lon: number } | null;
  showCandidates: boolean;

  /** The Flight Briefing page's own data (hazards, METAR, forecast,
   *  airport info) -- fetched on demand when that page is actually
   *  opened, not as part of `plan()`, the same reasoning
   *  `describeCheckpoints` already follows. */
  briefing: Briefing | null;
  briefingError: string | null;
  loadingBriefing: boolean;

  /** The Flight Briefing page's own spoken/read narrative -- a short
   *  paragraph one Claude call writes from the data already loaded
   *  above. Pilot-triggered (a button), not fetched alongside
   *  `briefing`: every call is a real, billed request, the same
   *  reasoning `descriptions` already follows. */
  narrative: string | null;
  narrativeError: string | null;
  loadingNarrative: boolean;
  /** Whether `window.speechSynthesis` is currently reading `narrative`
   *  aloud -- lives here, not as local state inside whichever button
   *  triggered it, since both the Flight Briefing page's own "Listen"
   *  button and the nav log's floating one (see `NavLogActions`) need
   *  to agree on it. */
  speaking: boolean;
}

function initialState(): PlanState {
  return {
    course: null, candidates: [], selected: [], legs: [], totals: null, nav: null,
    descriptions: {}, descriptionError: null, descriptionProgress: null,
    routes: [], stage: null, navStage: null, error: null, navError: null, needsBuild: null, building: null,
    selectedPoint: null, showCandidates: true,
    briefing: null, briefingError: null, loadingBriefing: false,
    narrative: null, narrativeError: null, loadingNarrative: false, speaking: false,
  };
}

export function usePlanState() {
  const [state, setState] = useState<PlanState>(initialState);
  const ref = useRef(state);
  ref.current = state;
  // TanStack Query's cache is used directly (fetchQuery), not its
  // useQuery/useMutation hooks -- loadRoutes, plan's own course/
  // checkpoints stages, and loadBriefing are the genuinely independent,
  // cacheable GETs here, each with its own staleTime picked for what
  // it actually is, not one default for all of them: course/checkpoints
  // (chart-reading plus a model inference, the same answer however long
  // ago it last ran) are staleTime: Infinity; briefing (live METAR/
  // forecast) keeps the client's own default of effectively always
  // revalidating. Everything else in this file either streams (plan's
  // nav-log legs -- live winds, deliberately refetched every time --
  // and describeCheckpoints) or shares mutable state with something
  // that does (saveDescription writes into the same `descriptions`
  // object describeCheckpoints streams into -- splitting just the
  // mutation half into Query's own cache would leave two sources of
  // truth for one field), so it stays exactly as hand-rolled as it
  // already was.
  const queryClient = useQueryClient();
  // One in-flight plan at a time. A second submit while the nav log of
  // the first is still outstanding would otherwise merge two routes'
  // legs.
  const planToken = useRef(0);
  // Which planToken a description stream has already been started for
  // -- calling describeCheckpoints again for the same route is a
  // harmless no-op (already in flight, or already done), so this is
  // what actually stops it from launching a second concurrent stream
  // every time the page toggles to the nav log view and back.
  const describeStarted = useRef<number | null>(null);
  // The in-flight description stream's own cancel switch -- present
  // only while one is actually running; a fresh plan() aborts whatever
  // this points to rather than let a stale route's checkpoints keep
  // streaming in.
  const describeAbort = useRef<AbortController | null>(null);

  const loadRoutes = useCallback(async () => {
    try {
      const { routes } = await queryClient.fetchQuery({ queryKey: ["routes"], queryFn: api.routes });
      setState(s => ({ ...s, routes }));
      return routes;
    } catch {
      return [];   // the datalist is a convenience; its absence is not an error
    }
  }, [queryClient]);

  const plan = useCallback(async (dep: string, dest: string, altitudeFt?: string) => {
    const token = ++planToken.current;
    describeStarted.current = null;
    describeAbort.current?.abort();
    describeAbort.current = null;
    setState(s => ({
      ...s,
      stage: "course", navStage: null, error: null, navError: null, needsBuild: null,
      course: null, candidates: [], selected: [], legs: [], totals: null,
      nav: null, descriptions: {}, descriptionError: null, descriptionProgress: null,
      selectedPoint: null, briefing: null, briefingError: null, loadingBriefing: false,
      narrative: null, narrativeError: null, loadingNarrative: false, speaking: false,
    }));
    window.speechSynthesis.cancel();

    try {
      // Through the query cache, staleTime: Infinity -- unlike the nav
      // log below (live wind, refetched every time on purpose), the
      // course and its scored checkpoints are chart-reading and a
      // model inference over a fixed corridor: the same answer today
      // as an hour ago, and the slower of this page's two stages to
      // redo. Keyed on dep/dest, so navigating away (Settings, Label)
      // and back to the *same* route serves this instantly from cache
      // instead of paying for it again -- a different route is a
      // different key, still a real fetch. Explicit fetchQuery, not
      // useQuery -- see this file's own comment above on why.
      const course = await queryClient.fetchQuery({
        queryKey: ["course", dep, dest], queryFn: () => api.course(dep, dest), staleTime: Infinity,
      });
      if (token !== planToken.current) return;
      setState(s => ({ ...s, course, stage: "checkpoints" }));

      const cp = await queryClient.fetchQuery({
        queryKey: ["checkpoints", dep, dest], queryFn: () => api.checkpoints(dep, dest), staleTime: Infinity,
      });
      if (token !== planToken.current) return;
      setState(s => ({ ...s, candidates: cp.candidates, selected: cp.selected, stage: "navlog" }));
    } catch (err) {
      if (token !== planToken.current) return;
      const detail = err instanceof Error ? err.message : String(err);
      // The only recoverable failure: the corridor exists, nobody has
      // collected it yet, and the page can start that job itself.
      if (err instanceof ApiError && err.status === 404 && detail.includes("not been collected")) {
        setState(s => ({ ...s, stage: null, needsBuild: { dep, dest }, error: null }));
      } else {
        setState(s => ({ ...s, stage: null, error: detail.split("\n")[0] ?? "request failed" }));
      }
      return;
    }

    try {
      for await (const msg of api.navlog(dep, dest, altitudeFt)) {
        if (token !== planToken.current) return;
        if (msg.type === "stage") {
          setState(s => ({ ...s, navStage: msg.detail }));
        } else if (msg.type === "error") {
          setState(s => ({
            ...s, stage: null, navStage: null,
            navError: msg.detail.split("\n")[0] ?? "could not build the nav log",
          }));
        } else if (msg.type === "altitude") {
          // Sent well before any leg -- the checkpoints already on
          // screen from the checkpoints stage can show their own
          // cruise altitude immediately instead of waiting on the
          // first leg to carry it.
          const { type: _type, ...rest } = msg;
          setState(s => ({ ...s, nav: rest }));
        } else if (msg.type === "leg") {
          // Appended one at a time, in arrival order -- the same order
          // `selected` is already in, so a row already on screen from
          // the checkpoints stage gets its dead-reckoning numbers the
          // moment its own leg arrives, not all 21 at once at the end.
          const { type: _type, ...leg } = msg;
          setState(s => ({ ...s, legs: [...s.legs, leg] }));
        } else {
          setState(s => ({ ...s, totals: msg.totals, stage: null, navStage: null }));
        }
      }
    } catch (err) {
      if (token !== planToken.current) return;
      const detail = err instanceof Error ? err.message : "could not build the nav log";
      setState(s => ({ ...s, stage: null, navStage: null, navError: detail.split("\n")[0] ?? "could not build the nav log" }));
    }
  }, []);

  /**
   * Collect a corridor, then plan it.
   *
   * Polled rather than awaited: this is Overpass, the FAA subscription
   * and an elevation lookup per candidate, which is minutes, and a
   * request held open that long dies in any proxy between here and the
   * server.
   */
  const build = useCallback(async (dep: string, dest: string) => {
    setState(s => ({ ...s, building: "starting…" }));
    const started = Date.now();
    try {
      const job = await api.startBuild(dep, dest);
      if (job.state === "done" || !job.job_id) {
        setState(s => ({ ...s, building: null, needsBuild: null }));
        await plan(dep, dest);
        return;
      }
      const jobId = job.job_id;
      for (;;) {
        await new Promise(r => setTimeout(r, 2000));
        let status;
        try {
          status = await api.buildStatus(jobId);
        } catch {
          continue;   // a transient blip should not abandon a running job
        }
        setState(s => ({ ...s, building: `${status.step} — ${elapsed(Date.now() - started)} elapsed` }));
        if (status.state === "done") {
          setState(s => ({ ...s, building: null, needsBuild: null }));
          await loadRoutes();
          await plan(dep, dest);
          return;
        }
        if (status.state === "failed") {
          setState(s => ({ ...s, building: status.detail ?? "build failed" }));
          return;
        }
      }
    } catch (err) {
      setState(s => ({ ...s, building: err instanceof Error ? err.message : String(err) }));
    }
  }, [plan, loadRoutes]);

  const selectPoint = useCallback(
    (point: { lat: number; lon: number } | null) => setState(s => ({ ...s, selectedPoint: point })),
    [],
  );
  const toggleCandidates = useCallback(
    () => setState(s => ({ ...s, showCandidates: !s.showCandidates })), []);

  /**
   * Streams one "how to spot it" line per checkpoint, filling
   * `descriptions` in as each arrives rather than waiting for all of
   * them -- a pilot's own one-shot "generate now" (the nav log's AI
   * button), not something that starts on its own, so a route whose
   * descriptions are never asked for never spends an LLM call on it.
   * Already in flight (or already done) for this route is a no-op, so
   * a second click before the first finishes costs nothing.
   */
  const describeCheckpoints = useCallback(async (dep: string, dest: string, altitudeFt?: string) => {
    const token = planToken.current;
    if (describeStarted.current === token) return;
    describeStarted.current = token;
    const controller = new AbortController();
    describeAbort.current = controller;
    try {
      for await (const msg of api.describeCheckpoints(dep, dest, altitudeFt, controller.signal)) {
        if (token !== planToken.current) return;   // a different route since this started
        if (msg.type === "start") {
          setState(s => ({ ...s, descriptionProgress: { done: 0, total: msg.count } }));
        } else if (msg.type === "checkpoint") {
          const key = descriptionKey(msg.lat, msg.lon);
          setState(s => ({
            ...s,
            descriptions: {
              ...s.descriptions,
              [key]: { text: msg.description ?? "", source: msg.source },
            },
            descriptionProgress: s.descriptionProgress
              && { ...s.descriptionProgress, done: s.descriptionProgress.done + 1 },
          }));
        } else if (msg.type === "error") {
          // Not one checkpoint's problem -- every remaining one would
          // fail the exact same way, but the server keeps sending a
          // per-checkpoint line for each anyway (see the endpoint's
          // own docstring), so this is still one error, not 21.
          setState(s => ({ ...s, descriptionError: msg.detail }));
        } else if (msg.type === "done") {
          setState(s => ({ ...s, descriptionProgress: null }));
        }
      }
    } catch {
      // An intentional abort (stopDescribing, or a fresh plan()
      // starting) lands here too, and should stay silent -- only a
      // genuine failure the pilot didn't ask for deserves a message,
      // and the server already sends that as its own "error" line
      // above rather than by the connection dying.
    } finally {
      if (describeAbort.current === controller) describeAbort.current = null;
    }
  }, []);

  /** A pilot's own edit, reflected locally right away rather than
   *  waiting on the round trip -- reverted back if the save itself
   *  fails, so a rejected/lost write never sits on screen looking
   *  saved when it was not. */
  const saveDescription = useCallback(
    async (dep: string, dest: string, lat: number, lon: number, text: string) => {
      const key = descriptionKey(lat, lon);
      const previous = ref.current.descriptions[key];
      setState(s => ({ ...s, descriptions: { ...s.descriptions, [key]: { text, source: "saved" } } }));
      try {
        await api.saveCheckpointNote(dep, dest, lat, lon, text);
      } catch (err) {
        // Reverting silently left a pilot's own edit just vanishing off
        // the checkpoint with nothing on screen saying why -- same gap
        // as an unguarded `void` call elsewhere, just via a caught
        // error instead of an uncaught one.
        setState(s => {
          const next = { ...s.descriptions };
          if (previous) next[key] = previous; else delete next[key];
          return { ...s, descriptions: next, error: `Couldn't save that description: ${(err as Error).message}` };
        });
      }
    },
    [],
  );

  /** The Flight Briefing page's own data -- fetched when that page is
   *  actually opened, not as part of `plan()`, so a route that's never
   *  briefed never spends the extra calls. Keyed to `planToken` the
   *  same way the description stream is, so a route change while a
   *  briefing fetch is still in flight can't land on the wrong route. */
  const loadBriefing = useCallback(async (dep: string, dest: string) => {
    const token = planToken.current;
    setState(s => ({ ...s, loadingBriefing: true, briefingError: null }));
    try {
      // Cached by dep/dest: re-opening the same route's briefing later
      // in the session (nav log -> map -> briefing again) serves the
      // already-fetched hazards/METAR/forecast instantly instead of
      // re-querying aviationweather.gov, without changing anything
      // about the planToken-guarded loading/error wiring around it.
      const data = await queryClient.fetchQuery({
        queryKey: ["briefing", dep, dest],
        queryFn: () => api.briefing(dep, dest),
      });
      if (token !== planToken.current) return;
      setState(s => ({ ...s, briefing: data, loadingBriefing: false }));
    } catch (err) {
      if (token !== planToken.current) return;
      const detail = err instanceof Error ? err.message : "could not load the briefing";
      setState(s => ({ ...s, loadingBriefing: false, briefingError: detail.split("\n")[0] ?? detail }));
    }
  }, [queryClient]);

  /** The narrative's own generation -- a pilot's own click, reading
   *  from `ref.current` rather than taking every piece as an argument
   *  the way `saveDescription` already does, since all of it (course,
   *  nav, totals, the briefing's own hazards/METARs/forecast, legs) is
   *  already sitting in state by the time this page can even show a
   *  "generate" button. */
  /** Returns the generated text directly (rather than making every
   *  caller read it back out of state right after an `await`, which
   *  would still see the pre-update value) -- `NavLogActions`' own
   *  "generate, then speak the moment it's ready" button needs the
   *  text itself, not just the side effect of it landing in state. */
  const loadNarrative = useCallback(async (dep: string, dest: string): Promise<string | null> => {
    const token = planToken.current;
    const s = ref.current;
    if (!s.course || !s.nav || !s.briefing) {
      setState(st => ({ ...st, narrativeError: "the briefing isn't fully loaded yet" }));
      return null;
    }
    setState(st => ({ ...st, loadingNarrative: true, narrativeError: null }));
    try {
      const data = await api.briefingNarrative({
        departure_ident: dep,
        destination_ident: dest,
        distance_nm: s.course.distance_nm,
        bearing_deg: s.course.bearing_deg,
        altitude_ft: s.nav.altitude_ft,
        aircraft_name: s.nav.aircraft.name,
        total_time_min: s.totals?.ete_min ?? null,
        total_fuel_gal: s.totals?.fuel_gal ?? null,
        hazards: s.briefing.hazards,
        metars: s.briefing.metars,
        forecast: s.briefing.forecast,
        legs: s.legs,
      });
      if (token !== planToken.current) return null;
      setState(st => ({ ...st, narrative: data.narrative, loadingNarrative: false }));
      return data.narrative;
    } catch (err) {
      if (token !== planToken.current) return null;
      const detail = err instanceof Error ? err.message : "could not generate the narrative";
      setState(st => ({ ...st, loadingNarrative: false, narrativeError: detail.split("\n")[0] ?? detail }));
      return null;
    }
  }, []);

  /** `window.speechSynthesis` rather than a cloud voice, for now --
   *  free, no new service, no API key; a more natural-sounding voice
   *  is a later upgrade, not a blocker for having this at all.
   *  `cancel()` first: speaking over an already-playing utterance
   *  queues instead of replacing it, so re-triggering this (the nav
   *  log's own button, after the Briefing page's) would otherwise read
   *  both back to back rather than restarting. */
  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setState(st => ({ ...st, speaking: false }));
    utterance.onerror = () => setState(st => ({ ...st, speaking: false }));
    window.speechSynthesis.speak(utterance);
    setState(st => ({ ...st, speaking: true }));
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setState(st => ({ ...st, speaking: false }));
  }, []);

  // Leaving the plan page (or the browser tab going elsewhere)
  // shouldn't leave a voice talking to an empty room.
  useEffect(() => () => window.speechSynthesis.cancel(), []);

  return {
    ...state, loadRoutes, plan, build, selectPoint, toggleCandidates,
    describeCheckpoints, saveDescription, loadBriefing, loadNarrative,
    speak, stopSpeaking,
  };
}
