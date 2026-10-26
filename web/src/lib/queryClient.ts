import { MutationCache, QueryCache, QueryClient, queryOptions } from "@tanstack/react-query";
import { ApiError, api, describeError, isDropped } from "./api/client";
import type { ChartInfo } from "./api/types";
import { readKept, writeKept } from "./storage";
import { clearProblem, raiseProblem, showError } from "./problems";

declare module "@tanstack/react-query" {
  interface Register {
    /** `silent`: this query's failure is not a system problem -- the
     *  page shows it in place (a route that has not been collected offers to
     *  collect it) -- either outright or for the errors a function
     *  picks out. */
    queryMeta: { silent?: boolean | ((error: unknown) => boolean) };
    /** `silent`: the mutation reports its own failure. */
    mutationMeta: { silent?: boolean };
  }
}

/**
 * The one query client, with every failure reported in one place: a
 * query that fails is a system problem in the server's own word for it,
 * with a "Try again" that refetches it, a mutation that fails is an
 * alert, and neither page threads error strings around to say so. The
 * exceptions are marked on the query or mutation itself (`meta`).
 *
 * No retries and no refetch on focus: the planner's calls are chart
 * reads, model inferences and streams of legs, and a pilot switching
 * back to the tab does not want the nav log recomputed under them.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const silent = query.meta?.silent;
      if (silent === true || (typeof silent === "function" && silent(error))) return;
      if (isDropped(error) && !askedAgain.has(query.queryHash)) {
        askedAgain.add(query.queryHash);
        whenBack(() => void queryClient.refetchQueries({ predicate: q => q.queryHash === query.queryHash }));
        return;
      }
      failingWith.set(query.queryHash, failed(describeError(error), retryable(error)));
    },
    onSuccess: (_data, query) => {
      askedAgain.delete(query.queryHash);
      forget(query.queryHash);
    },
  }),
  // A mutation is something the pilot just did: its failure is the
  // alert's, with OK (lib/problems).
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return;
      showError(describeError(error));
    },
  }),
});

/**
 * One problem per distinct thing that went wrong, not one per call that
 * hit it: a system problem (lib/problems), the line beside the map's
 * buttons, until the queries it was about answer.
 *
 * Keyed by the message, not the query: a planner that is down failed the
 * course, the detection stream and the nav log, and three identical
 * "planner service unreachable" toasts stacked up the screen, each
 * offering to retry a third of the page. Its Try again refetches
 * everything currently in error.
 */
/** Which problem each failing query raised: a query's hash to its id. */
const failingWith = new Map<string, string>();

/**
 * A query whose connection dropped, asked again by itself once before it
 * is said: Safari drops a page's requests as the phone locks or the app
 * goes behind another (its "Load failed"), and a pilot coming back found
 * "The connection dropped" over a route the planner answers in two
 * seconds (the owner's screenshot, 2026-10-22). Asked again once the page
 * is in sight and the phone online, a second after; said only if that
 * fails too.
 */
const askedAgain = new Set<string>();

export function whenBack(run: () => void, doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document) {
  const ready = () => doc.visibilityState === "visible" && globalThis.navigator?.onLine !== false;
  const done = () => {
    doc.removeEventListener("visibilitychange", go);
    globalThis.removeEventListener?.("online", go);
  };
  function go() {
    if (!ready()) return;
    done();
    setTimeout(run, 1000);
  }
  doc.addEventListener("visibilitychange", go);
  globalThis.addEventListener?.("online", go);
  go();
}

/** A failure's problem goes once every query it was about answers, or
 *  is no longer asked for: a route changed or closed. With no close of
 *  its own, a problem left behind by a route long gone stayed. */
function forget(hash: string) {
  askedAgain.delete(hash);
  const id = failingWith.get(hash);
  failingWith.delete(hash);
  if (id !== undefined && ![...failingWith.values()].includes(id)) clearProblem(id);
}
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "removed" || (event.type === "observerRemoved" && event.query.getObserversCount() === 0)) {
    forget(event.query.queryHash);
  }
});

function failed(message: string, retry: boolean): string {
  const id = `failed:${message}`;
  raiseProblem({
    id, title: message,
    retry: retry ? () => void queryClient.refetchQueries({ predicate: query => query.state.status === "error" }) : undefined,
  });
  return id;
}

/** Whether asking again could answer differently: not for what the
 *  request itself got wrong -- a 4xx, a route with no legal altitude
 *  (lib/api/streams) -- where Try again only showed the same toast
 *  again; a timeout or a rate limit can pass. */
function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status < 400 || error.status >= 500 || error.status === 408 || error.status === 429;
}

/*
 * The queries more than one component observes, defined once. TanStack
 * Query keeps one set of options per query, and each observer that
 * mounts writes its own over them -- `meta` included, which is what
 * decides above whether a failure toasts. Spelled out at each site,
 * the same failure toasted or stayed quiet depending on which component
 * happened to render last. The policy lives here; a site adds only
 * what is its own (`enabled`, `placeholderData`).
 */

/** Who is signed in, if anyone. Never a toast: the pilot console shows
 *  a failed check in place ("Retry sign-in check"), and the header's
 *  Dev switch, which observes it too, simply stays hidden. */
// Fresh for a minute: every tab of the planning panel reads it, and each
// switch asked again (/api/me, measured on every one).
export const pilotQuery = queryOptions({ queryKey: ["pilot"], queryFn: () => api.me(), staleTime: 60_000, meta: { silent: true } });

/** The planner's snapshot of the stack, which the Developer console
 *  and the training drawer's Retrain button poll together. Fresh for
 *  one poll's interval: opening the console within it shows the
 *  snapshot already here, where it used to ask again on every open and
 *  draw the console twice. */
export const statusQuery = queryOptions({
  queryKey: ["status"], queryFn: () => api.status(), staleTime: 30_000, refetchInterval: 30_000,
});

/** How this deployment is reached (SIGN_IN, OPEN or CLOSED) and which
 *  sign-ins it offers: asked once, and quiet on failure -- whoever reads
 *  it treats no answer as "not offered". */
export const capabilitiesQuery = queryOptions({
  queryKey: ["signInCapabilities"], queryFn: () => api.capabilities(), retry: false,
  staleTime: Infinity, meta: { silent: true },
});

/** A route's course: its airports, any stops among them, and the line
 *  through them, the same answer for as long as the page is open. No
 *  `meta` -- a course that fails is the page's first news that the
 *  planner is down. */
export const courseQuery = (dep: string, dest: string, stops: string[] = []) => queryOptions({
  queryKey: ["course", dep, dest, stops.join(",")], queryFn: ({ signal }) => api.course(dep, dest, stops, signal), staleTime: Infinity,
});

/** A route's checkpoints off the chart: the planner's, kept until the
 *  chart or the model changes (app.scoring), so never stale here. Asked
 *  for by the plan (usePlan) and ahead of Fly Here (PlanWorkspace). Given
 *  up when nothing asks for the route any more (`signal`, which TanStack
 *  aborts as the last observer leaves): a route typed a stop at a time
 *  left each stop's request reading the chart for up to 10 s, and over
 *  HTTP/1.1 a browser's six connections to the page filled with them --
 *  a card, the next route's course and the tiles waited behind
 *  (2026-10-07). The planner's read goes on and is kept either way. */
export const checkpointsQuery = (dep: string, dest: string, stops: string[] = []) => queryOptions({
  queryKey: ["checkpoints", dep, dest, stops.join(",")],
  queryFn: ({ signal }) => api.checkpoints(dep, dest, stops, signal), staleTime: Infinity,
});

/** The route from the side -- the ground under it and the Class B, C and
 *  D it passes through -- for FPL's side view, a dry run's chart and the
 *  nav log's printed Profile alike, one answer for all three (its key).
 *  Quiet: each draws the route without it where it fails. */
export const routeProfileQuery = (dep: string, dest: string, stops: string[] = []) => queryOptions({
  queryKey: ["route-profile", dep, ...stops, dest],
  queryFn: () => api.routeProfile(dep, dest, stops), staleTime: Infinity, meta: { silent: true },
});

/** The Class B airports and their weather. The airspace never moves and
 *  the planner holds the weather for minutes, so refetching per pan
 *  would ask the same cache the same question; and quiet, because the
 *  layer and the chips show what they have in place. */
/** The chart alone, for a map with no route on it yet. The map draws
 *  nothing until it has it -- the empty frame, blue in the dark, that the
 *  pilot saw on every load while it was asked for -- so the last answer
 *  is kept in this browser and the map drawn from it at once, asked for
 *  again behind it when it is an hour old (the charts change every 56
 *  days). */
const CHART_KEY = "wingtip.chart";
type Kept = { at: number; chart: ChartInfo };
function keptChart(): Kept | undefined {
  return readKept<Kept | undefined>(CHART_KEY, undefined) ?? undefined;
}
export const chartQuery = queryOptions({
  queryKey: ["chart"],
  queryFn: async () => {
    const chart = await api.chart();
    // No storage: the next load asks again, as it always did.
    writeKept(CHART_KEY, { at: Date.now(), chart } satisfies Kept);
    return chart;
  },
  staleTime: 60 * 60_000,
  initialData: () => keptChart()?.chart,
  initialDataUpdatedAt: () => keptChart()?.at,
});

/** Every TFR, for the map: held five minutes, as the FAA's site updates
 *  them every few. Not silent: a sky drawn with none when the FAA's site
 *  is down must say so. */
export const tfrsQuery = queryOptions({
  queryKey: ["tfrs"], queryFn: () => api.tfrs(), staleTime: 5 * 60_000, refetchInterval: 10 * 60_000,
});

/** The fields nearest a position, asked again only when it has moved a
 *  few miles (a twentieth of a degree): not at every GPS fix. */
export const nearestQuery = (lat: number, lon: number) => {
  const at = (n: number) => Math.round(n * 20) / 20;
  return queryOptions({
    queryKey: ["nearest", at(lat), at(lon)], queryFn: () => api.nearestAirports(at(lat), at(lon)), staleTime: 10 * 60_000,
    meta: { silent: true },
  });
};

/** A tracked flight's airplane, where it took off and its path today
 *  (vfr.traffic.flight): read again every minute while it is tracked, by
 *  its card and the map's path alike. Quiet: the card says what it has. */
export const flightQuery = (hex: string) => queryOptions({
  queryKey: ["flight", hex], queryFn: () => api.trafficFlight(hex), staleTime: 60_000, refetchInterval: 60_000,
  meta: { silent: true },
});

/** An airplane's state now, for the alerts a pilot set on it
 *  (AircraftAlerts): asked every fifteen seconds while the app is open and
 *  an alert waits on it -- the planner reads adsb.lol's recent trace, a
 *  static file, no turn of its API -- and not while the page is hidden.
 *  Quiet: a missed answer is the next one's to make up. */
export const flightStatusQuery = (hex: string) => queryOptions({
  queryKey: ["flight-status", hex], queryFn: () => api.trafficStatus(hex), staleTime: 10_000, refetchInterval: 15_000,
  retry: false, meta: { silent: true },
});

/** The route a tracked flight's number is scheduled to fly, asked once a
 *  callsign (vfr.traffic.route; the planner keeps it six hours): where the
 *  airplane is says whether it is on it, so the position, to a degree, is
 *  in the key and a diversion or a reused callsign is asked again. Quiet,
 *  as the flight's. */
export const routeQuery = (callsign: string | null, at: { lat: number; lon: number } | null) => queryOptions({
  queryKey: ["route", callsign, at ? Math.round(at.lat) : null, at ? Math.round(at.lon) : null], queryFn: () => api.trafficRoute({ callsign: callsign!, ...at }),
  enabled: !!callsign, staleTime: 30 * 60_000, meta: { silent: true },
});

/** The deployment's key for Google's map tiles (routers/basemaps), asked
 *  once a visit; an error, quiet, where it has none and the map offers
 *  no Google overlay (OverlayTiles, MapSettings). */
export const googleMapsQuery = queryOptions({
  queryKey: ["googleMaps"], queryFn: () => api.googleMaps(), staleTime: Infinity, retry: false, meta: { silent: true },
});

export const classBQuery = queryOptions({
  queryKey: ["classB"], queryFn: () => api.classB(), staleTime: 5 * 60_000, meta: { silent: true },
});

/** An airport's card's data -- its weather, frequencies, runways, pattern
 *  and airspace -- for everything that asks of one: the card, the tiles'
 *  chart marks and colours, the route's ends, a saved flight's fields, the
 *  traffic question's field, a Favorite kept. Ten wrote it out, fresh for
 *  five minutes or for an hour, raising the page's problem or not, so
 *  whether a failed lookup showed depended on which had mounted last (the
 *  commonality audit's N-13). Five minutes, a report's freshness; quiet,
 *  the card saying in place what it could not have (PlaceCard). */
export const airportQuery = (ident: string) => queryOptions({
  queryKey: ["airport", ident], queryFn: () => api.airport(ident), staleTime: 5 * 60_000, meta: { silent: true },
});

/** What a field offers on the ground (api.airportServices): the stop's
 *  card's and a suggested stop's row's. The FAA's cycle and Overture's
 *  monthly release change it, so it is good for the page's life; quiet,
 *  the card saying in place what it could not have. */
export const servicesQuery = (ident: string) => queryOptions({
  queryKey: ["airport-services", ident], queryFn: () => api.airportServices(ident), staleTime: Infinity, meta: { silent: true },
});

/** An airport's pictures (api.airportPhotos), behind its card's diagram:
 *  the imagery and the article change in years, so good for the page's
 *  life; quiet, the card showing the diagram alone without them. */
export const photosQuery = (ident: string) => queryOptions({
  queryKey: ["airport-photos", ident], queryFn: () => api.airportPhotos(ident), staleTime: Infinity, meta: { silent: true },
});

/** The fields round a position with food a walk from the ramp
 *  (api.airportsFood), for the map's fly-in food: by the position to a
 *  twentieth of a degree, asked again every two seconds while the
 *  planner is still reading some fields' places (`pending`). */
export const airportsFoodQuery = (lat: number, lon: number) => {
  const at = (n: number) => Math.round(n * 20) / 20;
  return queryOptions({
    queryKey: ["airports-food", at(lat), at(lon)], queryFn: () => api.airportsFood(at(lat), at(lon)),
    staleTime: 30 * 60_000, meta: { silent: true },
    refetchInterval: query => (query.state.data?.pending ? 2000 : false),
  });
};

/** The fields along the route to stop at (api.routeStops), for the map's
 *  Stops: asked again every two seconds while the planner is still reading
 *  some fields' places (`pending`), then kept for the route. */
export const routeStopsQuery = (dep: string, dest: string, stops: string) => queryOptions({
  queryKey: ["route-stops", dep, dest, stops], queryFn: () => api.routeStops(dep, dest, stops),
  staleTime: 60 * 60_000, meta: { silent: true },
  refetchInterval: query => (query.state.data?.pending ? 2000 : false),
});

/** The ways to fly a route (api.routeOptions), for FPL's Routes: the
 *  planner's read of the TAFs and METARs is ten minutes old at most, so
 *  that long; quiet, FPL saying nothing of them where they are not had. */
export const routeOptionsQuery = (...args: Parameters<typeof api.routeOptions>) => queryOptions({
  queryKey: ["route-options", ...args], queryFn: () => api.routeOptions(...args), staleTime: 10 * 60_000, meta: { silent: true },
});

/** An approach's plate placed on the map, and whether it publishes
 *  circling minimums (vfr.plates): the map's (PlateLayer) and the route's
 *  runway chips' (ProceduresRoute). A plate placed stays good for its
 *  cycle's 28 days; none placed is said by none drawn, not a retry. */
export const plateQuery = (airport: string, id: string) => queryOptions({
  queryKey: ["plate", airport, id], queryFn: () => api.plate(airport, id), staleTime: 6 * 60 * 60_000, retry: false, meta: { silent: true },
});

/** The pilot's saved flights, for FPL's Saved and its list in full: quiet,
 *  each saying in place what it could not fetch (QueryState). */
export const flightsQuery = queryOptions({
  queryKey: ["flights"], queryFn: () => api.flights.list(), meta: { silent: true },
});

/** The pilot's training record: the logbook's, the checkride's, the
 *  Brief's mock oral and solo review's, a flight's page's. */
export const trainingQuery = queryOptions({ queryKey: ["training"], queryFn: () => api.training.get() });

/** The pilot's own airplanes, for the aircraft chips, the Brief and
 *  Setup's Aircraft: fresh for a minute. */
export const aircraftListQuery = queryOptions({
  queryKey: ["aircraft"], queryFn: () => api.aircraft.list(), staleTime: 60_000,
});

/** The airplanes' book figures the planner flies: the same while the page
 *  is open. */
export const aircraftProfilesQuery = queryOptions({
  queryKey: ["aircraftProfiles"], queryFn: () => api.aircraftProfiles(), staleTime: Infinity,
});

/** The pilot's currency from the logbook: fresh for a minute. */
export const currencyQuery = queryOptions({
  queryKey: ["currency"], queryFn: () => api.logbook.currency(), staleTime: 60_000,
});
