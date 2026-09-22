import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { cn } from "cn";
import { api } from "../../lib/api/client";
import type { AircraftChoice, AircraftProfileSummary, AltitudeChoice, Candidate } from "../../lib/api/types";
import { identOf, identSchema } from "../../lib/identSchema";
import { DEFAULT_AIRCRAFT, usePreferences } from "../../lib/preferences";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling.
import "leaflet/dist/leaflet.css";
import { useProgressToast } from "../../lib/useProgressToast";
import type { WorkspaceProps } from "../page/workspace";
import { PilotPanel } from "../pilot/PilotPanel";
import BuildNotice from "./components/BuildNotice";
import FlightBriefingView from "./components/briefing/FlightBriefingView";
import NavLogActions from "./components/navlog/NavLogActions";
import NavLogView from "./components/navlog/NavLogView";
import RouteMap from "./components/RouteMap";
import { descriptionKey, usePlan } from "./hooks/usePlan";

// The three stages a plan actually goes through, in order -- there's
// no finer-grained number to report while one of them is running, so
// the status toast shows progress as "whichever of these three just
// finished," not a truly continuous percentage.
const STAGE_PERCENT: Record<"course" | "checkpoints" | "navlog", number> = {
  course: 25, checkpoints: 60, navlog: 90,
};

/** Which of the three altitude plans the log flies -- lowest unless the
 *  URL says otherwise, since it is the predictable one. */
function altitudeChoiceOf(value: string | null): AltitudeChoice {
  return value === "highest" || value === "fastest" ? value : "lowest";
}

/** One value per choice for the Select: a pilot's own by id, a stock
 *  profile by name. */
function aircraftKey(a: AircraftChoice): string {
  return a.aircraftId != null ? `mine:${a.aircraftId}` : `profile:${a.profile}`;
}

/** A pilot's own aeroplane rides on the stock profile whose name
 *  matches its type designator (a C172 on c172) for the service ceiling
 *  the altitude selection needs; anything else rides on the default. */
function baseProfile(typeDesignator: string, profiles: AircraftProfileSummary[]): string {
  const wanted = typeDesignator.toLowerCase().replace(/[^a-z0-9]/g, "");
  return profiles.find(p => p.name === wanted)?.name ?? DEFAULT_AIRCRAFT.profile;
}

/**
 * The planner: two idents in, a charted course with checkpoints and a
 * dead-reckoning nav log out -- the pilot's workspace on the page
 * (MapPage), which owns the shell around it and the route typed into
 * it.
 *
 * The address is the plan: the route, the altitude, the plan chosen
 * and the departure time are its query parameters, and every stage
 * (usePlan) is a query keyed on the ones it depends on. Loading a
 * route writes the address; a new aeroplane or departure time changes
 * a key; and the screen is derived from the queries on each render,
 * nothing kept in step by hand.
 */
export default function PlanWorkspace({ dep, dest, onRoute, sidebarOpen, children }: WorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const planned = { dep: identOf(searchParams.get("dep")), dest: identOf(searchParams.get("dest")) };
  const altitudeFt = searchParams.get("altitude_ft") ?? "";
  const altitudeChoice = altitudeChoiceOf(searchParams.get("altitude_choice"));
  // The departure time as an ISO instant, or "" for about now. It picks
  // the winds forecast period the planner flies the legs on, gives
  // every checkpoint an ETA, and is what a saved flight is planned for.
  const depart = searchParams.get("depart") ?? "";
  // The Custom altitude box's own draft, sent with the next load.
  const [alt, setAlt] = useState(altitudeFt);
  // Load pressed again for the same route: a fresh nav log, fresh winds.
  const [load, setLoad] = useState(0);
  // The aeroplane the nav log is computed for: remembered per browser
  // (the preferences store), since a pilot flies the same one for a
  // while; a stock profile until they pick one of their own.
  const aircraft = usePreferences(p => p.aircraft);
  const setAircraft = usePreferences(p => p.setAircraft);
  const s = usePlan({ dep: planned.dep, dest: planned.dest, altitudeFt, altitudeChoice, depart, aircraft, load }, sidebarOpen);
  const { course, selected } = s;

  // Open on whatever corridor exists, so the page is never an empty
  // form with no hint of what it accepts: the first collected route
  // when the address names none, written into the address like a load.
  const routes = useQuery({ queryKey: ["routes"], queryFn: api.routes, staleTime: Infinity });
  useEffect(() => {
    if ((planned.dep && planned.dest) || !routes.data) return;
    const first = routes.data.routes[0] ?? { departure_ident: "C81", destination_ident: "KDLH" };
    const d = planned.dep || first.departure_ident;
    const a = planned.dest || first.destination_ident;
    onRoute(d, a);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("dep", d);
      next.set("dest", a);
      return next;
    }, { replace: true });
  }, [planned.dep, planned.dest, routes.data, onRoute, setSearchParams]);

  // The stock profiles, plus a signed-in pilot's own aeroplanes on top
  // of them -- the same ["pilot"]/["aircraft"] queries the pilot
  // console keeps.
  const { data: profiles } = useQuery({ queryKey: ["aircraftProfiles"], queryFn: api.aircraftProfiles, staleTime: Infinity });
  const { data: pilot } = useQuery({ queryKey: ["pilot"], queryFn: api.me });
  const { data: myAircraft } = useQuery({ queryKey: ["aircraft"], queryFn: api.aircraft.list, enabled: !!pilot });
  const aircraftOptions = useMemo<AircraftChoice[]>(() => {
    const options: AircraftChoice[] = [
      ...(profiles ?? []).map(p => ({ profile: p.name, label: `${p.name.toUpperCase()} · ${p.type}` })),
      ...(myAircraft ?? []).map(a => ({
        profile: baseProfile(a.typeDesignator, profiles ?? []), label: `${a.tailNumber} · ${a.typeDesignator}`,
        cruiseTasKt: a.cruiseTasKt, fuelBurnGph: a.fuelBurnGph, usableFuelGal: a.usableFuelGal ?? undefined,
        aircraftId: a.id,
      })),
    ];
    // The remembered choice stays selectable while the lists load, and
    // an aeroplane deleted since is still what this plan was flown in.
    return options.some(o => aircraftKey(o) === aircraftKey(aircraft)) ? options : [aircraft, ...options];
  }, [profiles, myAircraft, aircraft]);

  const controls = useRef<{ fit: () => void } | null>(null);
  // A stable identity, not an inline arrow at the RouteMap call site --
  // that map's own course-load effect lists onReady as a dependency,
  // and a fresh function every render would re-run it (tearing down and
  // rebuilding every map layer) on every unrelated re-render, not just
  // when the course actually changes.
  const handleMapReady = useCallback((c: { fit: () => void }) => {
    controls.current = c;
  }, []);

  // Whichever waypoint is focused -- by its own coordinates, not a row
  // index, since the map's markers and the nav log's rows are two
  // orderings of the same points -- and only for the route it was
  // picked on: a new route starts with nothing selected.
  const routeKey = `${planned.dep}-${planned.dest}`;
  const [selection, setSelection] = useState<{ route: string; point: { lat: number; lon: number } } | null>(null);
  const selectedPoint = selection?.route === routeKey ? selection.point : null;
  const selectPoint = useCallback(
    (point: { lat: number; lon: number } | null) => setSelection(point && { route: routeKey, point }),
    [routeKey],
  );
  const [showCandidates, setShowCandidates] = useState(true);

  const submit = useCallback(() => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a || d === a) return;
    const next: Record<string, string> = { dep: d, dest: a };
    if (alt.trim()) next.altitude_ft = alt.trim();
    if (altitudeChoice !== "lowest") next.altitude_choice = altitudeChoice;
    if (depart) next.depart = depart;
    if (sidebarOpen) next.view = "briefing";
    setSearchParams(next, { replace: true });
    setLoad(n => n + 1);
  }, [dep, dest, alt, altitudeChoice, depart, sidebarOpen, setSearchParams]);

  // A different aeroplane means different legs: remembered, and the
  // nav log's own key changes with it.
  const changeAircraft = useCallback((value: string) => {
    const next = aircraftOptions.find(o => aircraftKey(o) === value);
    if (next) setAircraft(next);
  }, [aircraftOptions, setAircraft]);

  // A different departure time may mean a different winds forecast:
  // kept in the address like the rest, which is what re-plans.
  const changeDepart = useCallback((iso: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (iso) next.set("depart", iso);
      else next.delete("depart");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // A different plan -- lowest, highest, fastest -- means different
  // legs too. A plan replaces a typed altitude: the Custom box empties
  // and the address drops it, so the log flies the plan and nothing
  // else.
  const changeAltitudeChoice = useCallback((choice: AltitudeChoice) => {
    setAlt("");
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("altitude_ft");
      if (choice === "lowest") next.delete("altitude_choice");
      else next.set("altitude_choice", choice);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // The map's own half of point selection -- clicking a checkpoint
  // marker focuses the same point the matching nav log row would.
  const selectCandidate = useCallback(
    (c: Candidate) => selectPoint({ lat: c.lat, lon: c.lon }),
    [selectPoint],
  );

  // Up/Down walks the nav log top to bottom -- departure, each scored
  // checkpoint, destination -- the same list order the drawer renders
  // in, syncing the map to whatever it lands on exactly the way
  // clicking that row would.
  const stepWaypoint = useCallback((delta: number) => {
    if (!course) return;
    const points = [
      { lat: course.departure.lat, lon: course.departure.lon },
      ...selected.map(c => ({ lat: c.lat, lon: c.lon })),
      { lat: course.destination.lat, lon: course.destination.lon },
    ];
    const at = selectedPoint
      ? points.findIndex(p => descriptionKey(p.lat, p.lon) === descriptionKey(selectedPoint.lat, selectedPoint.lon))
      : -1;
    const next = points[Math.max(0, Math.min(points.length - 1, (at < 0 ? 0 : at + delta)))];
    if (next) selectPoint(next);
  }, [course, selected, selectedPoint, selectPoint]);

  // The map's zoom button: zoomed out, this zooms in to whatever's
  // selected (or departure, the first point, if nothing is yet);
  // zoomed in, it zooms back out to the whole route. `zoomedIn` comes
  // from RouteMap's own real zoom level, not which of these two actions
  // last ran.
  const [zoomedIn, setZoomedIn] = useState(false);
  const toggleZoom = useCallback(() => {
    if (!course) return;
    if (zoomedIn) { controls.current?.fit(); return; }
    selectPoint(selectedPoint ?? { lat: course.departure.lat, lon: course.departure.lon });
  }, [course, selectedPoint, selectPoint, zoomedIn]);

  // One pair of keys: Up and Down walk the nav log's own order --
  // departure, each checkpoint, destination -- and the map follows,
  // exactly as clicking a row would. The letters this used to bind
  // (`n` for the drawer, `f` to fit the route, `a` for every rated
  // landmark) each have a button now -- the header's own toggle, the
  // map's zoom, the layers popover -- and a letter shortcut is the
  // kind that fires while a pilot is typing a checkpoint note.
  //
  // Skipped while a field has focus: a description is a <textarea>,
  // and a plain letter used to land in one mid-sentence. Skipped too
  // for a press a Radix layer already used (the aircraft picker's list
  // walks with the same arrows), which it marks by preventing the
  // default -- except on a section title, which prevents Up and Down
  // itself precisely so this walk gets them (see BriefingSection).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const onSectionTitle = !!target?.closest('[data-slot="accordion-trigger"]');
      if ((e.defaultPrevented && !onSectionTitle) || target?.closest('[role="listbox"],[role="dialog"][aria-modal="true"],[role="menu"]')) return;
      e.preventDefault();
      stepWaypoint(e.key === "ArrowDown" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stepWaypoint]);

  // One floating progress line for the whole page: the briefing's own
  // fetch first (it only runs while the drawer is open), then the nav
  // log's own stage (scoring, altitude selection, the live
  // aviationweather.gov fetch), then the plan's own stages, then the
  // checkpoint description count -- never two at once. Failures are
  // the query client's to report (queryClient.ts).
  useProgressToast(
    (s.loadingBriefing ? "Loading briefing…" : null)
    ?? s.navStage
    ?? (s.stage === "course" ? "Drawing course…" : null)
    ?? (s.stage === "checkpoints" ? "Scoring checkpoints…" : null)
    ?? (s.stage ? `Planning… ${STAGE_PERCENT[s.stage]}%` : null)
    ?? (s.descriptionProgress ? `Generating ${s.descriptionProgress.done}/${s.descriptionProgress.total}` : null),
  );

  // The flight planning drawer: the nav log as the first section, the
  // briefing's sections under it, the briefing's own actions in the
  // drawer's header.
  const navLog = (
    <NavLogView
      totals={s.totals} nav={s.nav} courseBearingDeg={course?.bearing_deg ?? null} legs={s.legs}
      onAltitudeChoiceChange={changeAltitudeChoice}
      depart={depart} onDepartChange={changeDepart}
      dep={planned.dep} dest={planned.dest}
      depName={course?.departure.name ?? null} destName={course?.destination.name ?? null}
      depLat={course?.departure.lat ?? 0} depLon={course?.departure.lon ?? 0}
      destLat={course?.destination.lat ?? 0} destLon={course?.destination.lon ?? 0}
      selected={selected}
      depElevationFt={course?.departure.elevation_ft ?? null}
      destElevationFt={course?.destination.elevation_ft ?? null}
      descriptions={s.descriptions}
      onSaveDescription={s.saveDescription}
      onGenerateDescriptions={s.generateDescriptions}
      descriptionsLoading={s.descriptionProgress !== null}
      actions={(
        <NavLogActions
          onGenerateNarrative={s.generateNarrative}
          langgraphNarrative={s.langgraphNarrative}
          crewaiNarrative={s.crewaiNarrative}
        />
      )}
      selectedPoint={selectedPoint} onSelectPoint={(lat, lon) => selectPoint({ lat, lon })}
      alt={alt} onAltChange={setAlt} onSubmit={submit}
      aircraftValue={aircraftKey(aircraft)}
      aircraftOptions={aircraftOptions.map(o => ({ value: aircraftKey(o), label: o.label }))}
      onAircraftChange={changeAircraft}
    >
      <FlightBriefingView
        course={course} totals={s.totals} nav={s.nav} legs={s.legs}
        dep={planned.dep} dest={planned.dest} selected={selected}
        briefing={s.briefing} briefingError={s.briefingError} loadingBriefing={s.loadingBriefing}
        langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
        aircraftLabel={aircraft.label} aircraftId={aircraft.aircraftId ?? null}
        depart={depart}
      />
    </NavLogView>
  );

  return children({
    // The map stays mounted beside the briefing (the arrow walk still
    // pans it) but stays off the paper: the drawer is the printed page.
    map: (
      <div className={cn("h-full w-full", sidebarOpen && "print:hidden")}>
        <RouteMap
          course={course}
          candidates={s.candidates}
          selected={selected}
          showCandidates={showCandidates}
          focus={selectedPoint}
          onSelectCandidate={selectCandidate}
          onReady={handleMapReady}
          onZoomChange={setZoomedIn}
          zoom={{ zoomedIn, onToggle: toggleZoom, disabled: !course }}
          showAll={{ on: showCandidates, onToggle: setShowCandidates }}
        />
      </div>
    ),
    sidebar: navLog,
    console: <PilotPanel course={course} />,
    submit,
    loading: s.stage !== null,
    notices: s.needsBuild ? (
      <BuildNotice dep={s.needsBuild.dep} dest={s.needsBuild.dest} building={s.building} onBuild={s.build} />
    ) : null,
  });
}
