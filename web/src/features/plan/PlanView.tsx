import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { cn } from "cn";
import { api } from "../../lib/api/client";
import type { AircraftChoice, AircraftProfileSummary, AltitudeChoice, Candidate } from "../../lib/api/types";
import { identSchema } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling. Imported here (not in main.tsx) so a page with no map
// never pays for it.
import "leaflet/dist/leaflet.css";
import Shell from "../../Shell";
import MapDrawer from "../../components/MapDrawer";
import DevSwitch from "../../components/DevSwitch";
import MapHeader from "../../components/MapHeader";
import SidebarToggleButton from "../../components/SidebarToggleButton";
import { usePageStatus } from "../../lib/usePageStatus";
import RouteMap from "./components/RouteMap";
import RouteForm from "../../components/RouteForm";
import BuildNotice from "./components/BuildNotice";
import NavLogView from "./components/navlog/NavLogView";
import NavLogActions from "./components/navlog/NavLogActions";
import FlightBriefingView from "./components/briefing/FlightBriefingView";
import { usePlanState, descriptionKey } from "./hooks/usePlanState";
import { PilotButton, PilotPanel } from "../pilot/PilotPanel";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

// The three stages a plan actually goes through, in order -- there's
// no finer-grained number to report while one of them is running, so
// the status popup shows progress as "whichever of these three just
// finished," not a truly continuous percentage.
const STAGE_PERCENT: Record<"course" | "checkpoints" | "navlog", number> = {
  course: 25, checkpoints: 60, navlog: 90,
};

// The aeroplane the nav log is computed for. Remembered per browser
// (localStorage), since a pilot flies the same one for a while; a
// stock profile until they pick one of their own.
const DEFAULT_AIRCRAFT: AircraftChoice = { profile: "c172", label: "C172 · Cessna 172" };
const AIRCRAFT_KEY = "vfr.aircraft";

function storedAircraft(): AircraftChoice {
  try {
    const raw = localStorage.getItem(AIRCRAFT_KEY);
    if (raw) return JSON.parse(raw) as AircraftChoice;
  } catch {
    // private window, or storage refused
  }
  return DEFAULT_AIRCRAFT;
}

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
 * dead-reckoning nav log out.
 *
 * Everything on screen is derived from the store on each render, which is
 * the difference that matters from the page this replaces. That one kept
 * `data` as a mutable object and re-ran whichever render function the
 * author remembered -- and the checkpoint rows had to be drawn a second
 * time by hand once the legs arrived, because nothing recomputed them.
 */
export default function PlanView() {
  useDocumentTitle("Plan a route — VFR Route");
  const s = usePlanState();
  // Named, not read as `s.x` inside the hooks below: each hook then
  // lists exactly what it reads, and the callbacks are stable
  // (`useCallback([])` in usePlanState) so listing them costs nothing.
  const {
    course, selected, selectedPoint, loadRoutes, plan, loadBriefing, describeCheckpoints, selectPoint, toggleCandidates,
  } = s;
  const [searchParams, setSearchParams] = useSearchParams();
  const [dep, setDep] = useState(searchParams.get("dep")?.toUpperCase() ?? "");
  const [dest, setDest] = useState(searchParams.get("dest")?.toUpperCase() ?? "");
  const [alt, setAlt] = useState(searchParams.get("altitude_ft") ?? "");
  const [altitudeChoice, setAltitudeChoice] = useState<AltitudeChoice>(() => altitudeChoiceOf(searchParams.get("altitude_choice")));
  // The departure time as an ISO instant, or "" for about now. It picks
  // the winds forecast period the planner flies the legs on, gives
  // every checkpoint an ETA, and is what a saved flight is planned for.
  const [depart, setDepart] = useState(searchParams.get("depart") ?? "");
  const [aircraft, setAircraft] = useState<AircraftChoice>(storedAircraft);
  // The stock profiles, plus a signed-in pilot's own aeroplanes on top
  // of them -- the same ["pilot"]/["aircraft"] queries the pilot
  // console keeps.
  const { data: profiles } = useQuery({ queryKey: ["aircraftProfiles"], queryFn: api.aircraftProfiles, staleTime: Infinity });
  const { data: pilot } = useQuery({ queryKey: ["pilot"], queryFn: api.me, retry: false });
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
  // rebuilding every map layer) on every unrelated PlanView re-render,
  // not just when the course actually changes.
  const handleMapReady = useCallback((c: { fit: () => void }) => {
    controls.current = c;
  }, []);
  const started = useRef(false);

  // The nav log drawer has two widths. Narrow, it is the table beside
  // the map; wide, it is the briefing -- the same table with the FAA
  // briefing sections under it and the narrative and Print in its
  // header -- with a strip of map still visible beside it. One nav
  // log, one place: the briefing used to be a separate view that
  // replaced the map and drew its own read-only copy of the table.
  //
  // Wide is driven by the URL (?view=briefing), not its own useState:
  // a pasted link lands on the briefing, `n` toggles it, and the
  // browser's back button leaves it. Narrow is plain state; the drawer
  // is open when either says so.
  const briefing = searchParams.get("view") === "briefing";
  const [navOpen, setNavOpen] = useState(briefing);
  const sidebarOpen = navOpen || briefing;
  // The pilot's own console, a drawer from the top of the map area --
  // the developer's page has the dev console in the same place. One
  // drawer at a time over the same map: opening one closes the other.
  const [pilotOpen, setPilotOpen] = useState(false);
  const setBriefingView = useCallback((open: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (open) next.set("view", "briefing");
      else next.delete("view");
      return next;
    }, { replace: true });
    if (open) {
      // So that narrowing it again leaves the nav log open, not nothing.
      setNavOpen(true);
      setPilotOpen(false);
    }
  }, [setSearchParams]);
  const closeSidebar = useCallback(() => {
    setNavOpen(false);
    if (briefing) setBriefingView(false);
  }, [briefing, setBriefingView]);
  const toggleSidebar = useCallback(() => {
    if (sidebarOpen) { closeSidebar(); return; }
    setNavOpen(true);
    setPilotOpen(false);
  }, [sidebarOpen, closeSidebar]);
  const togglePilot = useCallback(() => {
    setPilotOpen(open => !open);
    closeSidebar();
  }, [closeSidebar]);

  // Open on whatever corridor exists, so the page is never an empty form
  // with no hint of what it accepts.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const routes = await loadRoutes();
      const first = routes[0] ?? { departure_ident: "C81", destination_ident: "KDLH" };
      const d = searchParams.get("dep")?.toUpperCase() || first.departure_ident;
      const a = searchParams.get("dest")?.toUpperCase() || first.destination_ident;
      setDep(d);
      setDest(a);
      void plan(
        d, a, searchParams.get("altitude_ft") ?? undefined, aircraft,
        altitudeChoiceOf(searchParams.get("altitude_choice")), searchParams.get("depart") ?? undefined,
      );
    })();
    // started.current makes this genuinely run-once on mount regardless
    // of the deps array below; loadRoutes/plan/searchParams/aircraft are
    // still listed (loadRoutes/plan are stable, []-deps callbacks in
    // usePlanState; the others only matter at this first read) so a
    // future refactor wouldn't silently go stale here undetected.
  }, [loadRoutes, plan, searchParams, aircraft]);

  // The briefing's own data (hazards, METAR, forecast, runways/
  // frequencies) is only worth fetching once a pilot actually opens
  // the nav log drawer, whose sections it fills in either width --
  // not on every plan(), which is why this is a separate effect from
  // the course/checkpoints/navlog load above. Keyed on the planned
  // course, not the typed idents: a re-plan (a different aeroplane,
  // say) clears the briefing and this fetches it again for the route
  // actually on screen, and a half-typed ident never triggers a fetch.
  useEffect(() => {
    if (sidebarOpen && course) void loadBriefing(course.departure.ident, course.destination.ident);
  }, [sidebarOpen, course, loadBriefing]);

  // The nav log's AI button: a pilot-triggered "generate now" for
  // every checkpoint's description at once. Descriptions are visible
  // (and editable) in every row regardless of whether this has ever
  // been clicked -- this just fills the blank ones in, and
  // describeCheckpoints is already a no-op for a route it's running
  // (or finished) for, so a second click before the first finishes
  // costs nothing.
  const generateDescriptions = useCallback(() => {
    void describeCheckpoints(dep, dest, alt.trim() || undefined);
  }, [dep, dest, alt, describeCheckpoints]);

  const submit = useCallback(() => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a || d === a) return;
    const next: Record<string, string> = { dep: d, dest: a };
    if (alt.trim()) next.altitude_ft = alt.trim();
    if (altitudeChoice !== "lowest") next.altitude_choice = altitudeChoice;
    if (depart) next.depart = depart;
    if (briefing) next.view = "briefing";
    setSearchParams(next, { replace: true });
    void plan(d, a, alt.trim() || undefined, aircraft, altitudeChoice, depart || undefined);
  }, [dep, dest, alt, altitudeChoice, depart, briefing, plan, setSearchParams, aircraft]);

  // A different aeroplane means different legs: remembered, then
  // re-planned right away for the route on screen.
  const changeAircraft = useCallback((value: string) => {
    const next = aircraftOptions.find(o => aircraftKey(o) === value);
    if (!next) return;
    setAircraft(next);
    try { localStorage.setItem(AIRCRAFT_KEY, JSON.stringify(next)); } catch { /* storage refused */ }
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (d && a && d !== a) void plan(d, a, alt.trim() || undefined, next, altitudeChoice, depart || undefined);
  }, [aircraftOptions, dep, dest, alt, altitudeChoice, depart, plan]);

  // A different departure time may mean a different winds forecast,
  // so the legs are re-planned; kept in the URL like the rest.
  const changeDepart = useCallback((iso: string) => {
    setDepart(iso);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (iso) next.set("depart", iso);
      else next.delete("depart");
      return next;
    }, { replace: true });
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (d && a && d !== a) void plan(d, a, alt.trim() || undefined, aircraft, altitudeChoice, iso || undefined);
  }, [dep, dest, alt, aircraft, altitudeChoice, plan, setSearchParams]);

  // A different plan -- lowest, highest, fastest -- means different
  // legs too: kept in the URL like the altitude itself, so a link or
  // the Dev switch carries it, then re-planned right away.
  const changeAltitudeChoice = useCallback((choice: AltitudeChoice) => {
    setAltitudeChoice(choice);
    // A plan replaces a typed altitude: the Custom box empties and the
    // URL drops it, so the log flies the plan and nothing else.
    setAlt("");
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("altitude_ft");
      if (choice === "lowest") next.delete("altitude_choice");
      else next.set("altitude_choice", choice);
      return next;
    }, { replace: true });
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (d && a && d !== a) void plan(d, a, undefined, aircraft, choice, depart || undefined);
  }, [dep, dest, aircraft, depart, plan, setSearchParams]);

  // The map's own half of point selection -- clicking a checkpoint
  // marker focuses the same point the matching nav log row would.
  const selectCandidate = useCallback(
    (c: Candidate) => selectPoint({ lat: c.lat, lon: c.lon }),
    [selectPoint],
  );

  // Up/Down walks the nav log top to bottom -- departure, each scored
  // checkpoint, destination -- the same list order the drawer renders
  // in, syncing the map to whatever it lands on exactly the way
  // clicking that row would (RouteMap's own `focus` prop, and
  // NavLogView's own scrollIntoView effect, both already key off
  // `selectedPoint`). The same list-stepping Label's own keyboard
  // handling does for its waypoint list, ported here since this
  // page's nav log has an equally obvious top-to-bottom order and no
  // single-leg "course-relative" concept of its own to step by instead.
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

  // Mirrors Label's own zoom button: zoomed out, this zooms in to
  // whatever's selected (or departure, the first point, if nothing is
  // yet -- "Start"); zoomed in, it zooms back out to the whole route
  // ("Fit route") rather than requiring the keyboard-only "f" shortcut.
  // `zoomedIn` comes from RouteMap's own real zoom level (see its own
  // comment), not which of these two actions last ran.
  const [zoomedIn, setZoomedIn] = useState(false);
  const toggleZoom = useCallback(() => {
    if (!course) return;
    if (zoomedIn) { controls.current?.fit(); return; }
    selectPoint(selectedPoint ?? { lat: course.departure.lat, lon: course.departure.lon });
  }, [course, selectedPoint, selectPoint, zoomedIn]);

  // Shortcuts, skipped while an ident is being typed -- or, just as
  // much, while a checkpoint description is: that field is a
  // <textarea>, not an <input>, and typing a plain "n" into one used
  // to open the briefing mid-sentence. Skipped, too, for a press a
  // Radix layer already used (the aircraft picker's list walks its
  // options with the same arrow keys; a popover's own Escape): those
  // mark the event default-prevented, or keep the focus inside a
  // listbox or dialog.
  // The map is always mounted now -- the briefing is a drawer over it,
  // not a view in its place -- so `f`/`t` and the arrow walk work with
  // the briefing open just as they do beside the narrow nav log.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // A modal dialog (the sign-in dialog) owns its keys; the drawers
      // are dialogs too but non-modal, and the walk goes on inside them.
      if (e.defaultPrevented || target?.closest('[role="listbox"],[role="dialog"][aria-modal="true"],[role="menu"]')) return;
      if (e.key === "n") setBriefingView(!briefing);
      if (e.key === "a") toggleCandidates();
      if (e.key === "f") controls.current?.fit();
      if (e.key === "ArrowDown") { e.preventDefault(); stepWaypoint(1); }
      if (e.key === "ArrowUp") { e.preventDefault(); stepWaypoint(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [briefing, setBriefingView, stepWaypoint, toggleCandidates]);

  // One row, the same shape as Dev's: the Dev-mode switch leading, the
  // route form -- not "VFR Route," the thing a pilot is here to use --
  // in the middle, and at the end the guide, the zoom toggle, the pilot
  // console and the nav log drawer's toggle, in the order Dev's own
  // four sit in. No tabs row: the briefing is the nav log drawer opened
  // wide, not a second view of the page.
  const header = (
    <MapHeader
      leading={<DevSwitch />}
      form={(
        <RouteForm
          dep={dep} dest={dest}
          onDepChange={setDep} onDestChange={setDest}
          onSubmit={submit}
          disabled={s.stage !== null}
        />
      )}
      actions={(
        <>
          <PilotButton open={pilotOpen} onClick={togglePilot} />
          <SidebarToggleButton open={sidebarOpen} onClick={toggleSidebar} label="Flight Planning" />
        </>
      )}
    />
  );

  // The nav log's own stage (scoring, altitude selection, the live
  // aviationweather.gov fetch) takes priority over the plan's own
  // course/checkpoints stages and the checkpoint description count
  // while it's running -- all four are the same floating status,
  // never two at once. This used to be two things -- this same
  // floating popup, plus a second, separate "drawing course…"/
  // "scoring checkpoints…" line inline in the header -- until both
  // ends of that redundancy got noticed at once; there's exactly one
  // place this app reports background progress, this is it. The
  // briefing's own fetch goes first: it only runs while the drawer is
  // open wide, and it's the reason this floating popup -- not an
  // inline line in the drawer -- is how the briefing shows "Loading
  // briefing…" too, the same as every other background fetch in this
  // app.
  // Neither framework narrative's own loading/error state feeds this --
  // both now show inline in NavLogActions' own Popover (a spinner while
  // generating, the error text in place of the narrative if it fails),
  // right next to the button that triggered them, rather than a second,
  // redundant report of the same thing up here.
  const progress = (s.loadingBriefing ? "Loading briefing…" : null)
    ?? s.navStage
    ?? (s.stage === "course" ? "Drawing course…" : null)
    ?? (s.stage === "checkpoints" ? "Scoring checkpoints…" : null)
    ?? (s.stage ? `Planning… ${STAGE_PERCENT[s.stage]}%` : null)
    ?? (s.descriptionProgress ? `Generating ${s.descriptionProgress.done}/${s.descriptionProgress.total}` : null);
  const briefingErrorMsg = s.briefingError && `Couldn't load the briefing: ${s.briefingError}`;
  const descError = s.descriptionError && `Couldn't generate checkpoint descriptions: ${s.descriptionError}`;
  // Default position (bottom-center, the Toaster's own app-wide
  // default now -- see main.tsx) works unmodified whatever is open --
  // nothing floats at the bottom of the map or of a drawer (the guide
  // button and the sidebar trigger both live in the header now, see
  // `header` above), so there's nothing left down there for this to
  // land on top of.
  // Three named sources, not one combined string -- a briefing failure
  // and an unrelated checkpoint-description failure used to share one
  // slot (whichever won a `??`/`||` chain), silently hiding the other;
  // now each gets its own stacking toast (see usePageStatus's own
  // comment).
  usePageStatus(progress, {
    general: s.error,
    navLog: s.navError,
    briefing: briefingErrorMsg && {
      message: briefingErrorMsg,
      retry: () => { if (course) void loadBriefing(course.departure.ident, course.destination.ident); },
    },
    description: descError,
    langgraph: s.langgraphNarrative.error && `LangGraph narrative failed: ${s.langgraphNarrative.error}`,
    crewai: s.crewaiNarrative.error && `CrewAI narrative failed: ${s.crewaiNarrative.error}`,
  });

  // One nav log in both widths, the briefing's sections under the
  // table in both: narrow, the table leads and the sections follow it,
  // closed; wide, the table folds into a section of its own and the
  // briefing's own actions join the header.
  const navLog = (
    <NavLogView
      totals={s.totals} nav={s.nav} courseBearingDeg={s.course?.bearing_deg ?? null} legs={s.legs}
      onAltitudeChoiceChange={changeAltitudeChoice}
      depart={depart} onDepartChange={changeDepart}
      dep={dep} dest={dest}
      depName={s.course?.departure.name ?? null} destName={s.course?.destination.name ?? null}
      depLat={s.course?.departure.lat ?? 0} depLon={s.course?.departure.lon ?? 0}
      destLat={s.course?.destination.lat ?? 0} destLon={s.course?.destination.lon ?? 0}
      selected={s.selected}
      depElevationFt={s.course?.departure.elevation_ft ?? null}
      destElevationFt={s.course?.destination.elevation_ft ?? null}
      descriptions={s.descriptions}
      onSaveDescription={(lat, lon, text) => s.saveDescription(dep, dest, lat, lon, text)}
      onGenerateDescriptions={generateDescriptions}
      descriptionsLoading={s.descriptionProgress !== null}
      expanded={briefing} onToggleExpanded={() => setBriefingView(!briefing)}
      actions={briefing ? (
        <NavLogActions
          onGenerateNarrative={framework => void s.loadFrameworkNarrative(framework, dep, dest)}
          langgraphNarrative={s.langgraphNarrative}
          crewaiNarrative={s.crewaiNarrative}
        />
      ) : null}
      selectedPoint={s.selectedPoint} onSelectPoint={(lat, lon) => s.selectPoint({ lat, lon })}
      alt={alt} onAltChange={setAlt} onSubmit={submit}
      aircraftValue={aircraftKey(aircraft)}
      aircraftOptions={aircraftOptions.map(o => ({ value: aircraftKey(o), label: o.label }))}
      onAircraftChange={changeAircraft}
    >
      <FlightBriefingView
        course={s.course} totals={s.totals} nav={s.nav} legs={s.legs}
        dep={dep} dest={dest} selected={s.selected}
        briefing={s.briefing} briefingError={s.briefingError} loadingBriefing={s.loadingBriefing}
        langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
        aircraftLabel={aircraft.label} aircraftId={aircraft.aircraftId ?? null}
        depart={depart}
        expanded={briefing}
      />
    </NavLogView>
  );

  return (
    <>
      {s.needsBuild && (
        <BuildNotice
          dep={s.needsBuild.dep} dest={s.needsBuild.dest} building={s.building}
          onBuild={() => void s.build(s.needsBuild!.dep, s.needsBuild!.dest)}
        />
      )}
      <Shell
        header={header}
        panels={(
          <MapDrawer side="top" open={pilotOpen} onOpenChange={setPilotOpen} label="Pilot">
            <PilotPanel course={s.course} />
          </MapDrawer>
        )}
        sidebarLabel="Flight Planning"
        sidebarWide={briefing}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={open => (open ? setNavOpen(true) : closeSidebar())}
        // The map stays mounted under the briefing (the drawer dims it,
        // the arrow walk still pans it) but stays off the paper: the
        // wide drawer is the printed page.
        map={
          <div className={cn("h-full w-full", briefing && "print:hidden")}>
            <RouteMap
              course={s.course}
              candidates={s.candidates}
              selected={s.selected}
              showCandidates={s.showCandidates}
              focus={s.selectedPoint}
              onSelectCandidate={selectCandidate}
              onReady={handleMapReady}
              onZoomChange={setZoomedIn}
              zoom={{ zoomedIn, onToggle: toggleZoom, disabled: !s.course }}
            />
          </div>
        }
        sidebar={navLog}
      />
    </>
  );
}
