import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "../../Shell";
import Sidebar from "../../components/Sidebar";
import { getParam, setParams as setUrlParams } from "../../lib/urlParams";
import RouteMap from "./components/RouteMap";
import RouteForm from "./components/RouteForm";
import BuildNotice from "./components/BuildNotice";
import CheckpointList from "./components/CheckpointList";
import NavLogCard from "./components/NavLogCard";
import MapLegend from "./components/MapLegend";
import { panelRows, summary } from "./format";
import { usePlanState } from "./hooks/usePlanState";

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
  const s = usePlanState();
  const [dep, setDep] = useState(getParam("dep")?.toUpperCase() ?? "");
  const [dest, setDest] = useState(getParam("dest")?.toUpperCase() ?? "");
  const [alt, setAlt] = useState(getParam("altitude_ft") ?? "");
  const controls = useRef<{ fit: () => void; toggleBasemap: () => string } | null>(null);
  const [basemap, setBasemap] = useState("FAA sectional");
  const started = useRef(false);

  // Open on whatever corridor exists, so the page is never an empty form
  // with no hint of what it accepts.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const routes = await s.loadRoutes();
      const first = routes[0] ?? { departure_ident: "C81", destination_ident: "KDLH" };
      const d = getParam("dep")?.toUpperCase() || first.departure_ident;
      const a = getParam("dest")?.toUpperCase() || first.destination_ident;
      setDep(d);
      setDest(a);
      void s.plan(d, a, getParam("altitude_ft") ?? undefined);
    })();
  }, []);

  const submit = useCallback(() => {
    const d = dep.trim().toUpperCase(), a = dest.trim().toUpperCase();
    if (!d || !a || d === a) return;
    const next: Record<string, string> = { dep: d, dest: a };
    if (alt.trim()) next.altitude_ft = alt.trim();
    setUrlParams(next);
    void s.plan(d, a, alt.trim() || undefined);
  }, [dep, dest, alt]);

  // Shortcuts, skipped while an ident is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "n") s.toggleNav();
      if (e.key === "a") s.toggleCandidates();
      if (e.key === "f") controls.current?.fit();
      if (e.key === "t") setBasemap(controls.current?.toggleBasemap() === "faa"
        ? "FAA sectional" : "OpenStreetMap");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const rows = s.course
    ? panelRows(s.course.departure, s.course.destination, s.course.distance_nm, s.selected, s.legs)
    : [];
  const focused = s.selectedRow !== null ? rows[s.selectedRow] ?? null : null;

  const toolbar = (
    <div className="border-b border-slate-200 bg-white p-3">
      <RouteForm
        dep={dep} dest={dest} alt={alt}
        onDepChange={setDep} onDestChange={setDest} onAltChange={setAlt}
        onSubmit={submit}
        disabled={s.stage !== null}
        routes={s.routes}
        summary={s.stage === "course"
          ? "drawing course…"
          : summary(s.course?.distance_nm ?? null, s.candidates.length, s.selected.length)}
      />
    </div>
  );

  const mapOverlay = s.error && (
    <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded bg-red-600 px-3 py-1.5 text-sm text-white shadow-md">
      {s.error}
    </div>
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
        toolbar={toolbar}
        mapOverlay={mapOverlay}
        map={
          <RouteMap
            course={s.course}
            candidates={s.candidates}
            selected={s.selected}
            showCandidates={s.showCandidates}
            navShown={s.showNav}
            focus={focused ? { lat: focused.lat, lon: focused.lon } : null}
            onReady={c => { controls.current = c; }}
          />
        }
        sidebar={
          <Sidebar>
            <CheckpointList
              rows={rows} selectedRow={s.selectedRow} onSelectRow={s.selectRow}
              placeholder={s.error ?? (s.stage ? "Scoring…" : "No route")}
            />
            <NavLogCard
              totals={s.totals} nav={s.nav} legs={s.legs} navError={s.navError}
              reading={s.stage === "navlog"} showNav={s.showNav} onToggle={s.toggleNav}
            />
            <MapLegend basemap={basemap} onFit={() => controls.current?.fit()} />
          </Sidebar>
        }
      />
    </>
  );
}
