import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RouteMap from "./RouteMap";
import { deg, one, panelRows, scoreColor, signed, summary, totalsParts } from "./format";
import { usePlanStore } from "./store";

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
  const s = usePlanStore();
  const [params, setParams] = useSearchParams();
  const [dep, setDep] = useState(params.get("dep")?.toUpperCase() ?? "");
  const [dest, setDest] = useState(params.get("dest")?.toUpperCase() ?? "");
  const [alt, setAlt] = useState(params.get("altitude_ft") ?? "");
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
      const d = params.get("dep")?.toUpperCase() || first.departure_ident;
      const a = params.get("dest")?.toUpperCase() || first.destination_ident;
      setDep(d);
      setDest(a);
      void s.plan(d, a, params.get("altitude_ft") ?? undefined);
    })();
  }, []);

  const submit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const d = dep.trim().toUpperCase(), a = dest.trim().toUpperCase();
    if (!d || !a || d === a) return;
    const next: Record<string, string> = { dep: d, dest: a };
    if (alt.trim()) next.altitude_ft = alt.trim();
    setParams(next, { replace: true });
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
  const totals = s.totals ? totalsParts(s.totals) : null;

  return (
    <>
      <header>
        <div className="hrow">
          <span className="brand">VFR planner</span>
          <form onSubmit={submit} autoComplete="off">
            <input value={dep} onChange={e => setDep(e.target.value)} list="built"
                   placeholder="DEP" spellCheck={false} aria-label="Departure" />
            <span className="arrow">→</span>
            <input value={dest} onChange={e => setDest(e.target.value)} list="built"
                   placeholder="DEST" spellCheck={false} aria-label="Destination" />
            <datalist id="built">
              {[...new Set(s.routes.flatMap(r => [r.departure_ident, r.destination_ident]))]
                .sort().map(id => <option key={id} value={id} />)}
            </datalist>
            <input id="alt" value={alt} onChange={e => setAlt(e.target.value)}
                   placeholder="alt (auto)" spellCheck={false} aria-label="Cruise altitude, feet" />
            <button type="submit" disabled={s.stage !== null}>Plan</button>
          </form>
          <span id="summary">
            {s.stage === "course"
              ? "drawing course…"
              : summary(s.course?.distance_nm ?? null, s.candidates.length, s.selected.length)}
          </span>
        </div>
      </header>

      {s.needsBuild && (
        <div id="notice" className="show">
          <span>
            {s.needsBuild.dep} → {s.needsBuild.dest} has not been collected yet.
            This takes a few minutes.
          </span>
          <button disabled={s.building !== null}
                  onClick={() => void s.build(s.needsBuild!.dep, s.needsBuild!.dest)}>
            Collect this route
          </button>
          <span className="spin">{s.building}</span>
        </div>
      )}

      <div id="middle">
        <RouteMap
          course={s.course}
          candidates={s.candidates}
          selected={s.selected}
          showCandidates={s.showCandidates}
          navShown={s.showNav}
          focus={focused ? { lat: focused.lat, lon: focused.lon } : null}
          onReady={c => { controls.current = c; }}
        />
        <div id="side">
          <h2>Checkpoints</h2>
          {!rows.length && (
            <div className="cp" style={{ cursor: "default", color: "var(--muted)" }}>
              {s.error ?? (s.stage ? "Scoring…" : "No route")}
            </div>
          )}
          {rows.map((r, i) => (
            <div key={`${r.kind}-${r.lat}-${r.lon}`}
                 className={`cp${r.kind === "endpoint" ? " endpoint" : ""}${i === s.selectedRow ? " on" : ""}`}
                 onClick={() => s.selectRow(i)}>
              {r.kind === "endpoint" ? (
                <>
                  <span className="num" style={{ background: "#142430" }}>{r.tag}</span>
                  <span className="nm">{r.ident}</span><span />
                  <span className="meta">{r.name}</span>
                </>
              ) : (
                <>
                  <span className="num" style={{ background: scoreColor(r.score) }}>{r.n}</span>
                  <span className="nm">{r.name}</span>
                  <span className="score" style={{ color: scoreColor(r.score) }}>
                    {r.score.toFixed(2)}
                  </span>
                  <span className="meta">
                    {r.category} · {r.along_track_nm.toFixed(1)} nm along
                    {r.nextLeg && ` · next leg ${r.nextLeg.distance_nm.toFixed(1)} nm, ` +
                                 `${deg(r.nextLeg.magnetic_heading_deg).replace("°", "")}°M`}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div id="navwrap">
        <div id="navbar" onClick={() => s.toggleNav()}>
          <span className="t">Nav log</span>
          {totals && (
            <span className="tot">
              <b>{totals.distance}</b> · <b>{totals.time}</b> · <b>{totals.fuel}</b>
              {totals.warning && <> · <span style={{ color: "var(--warn)" }}>{totals.warning}</span></>}
            </span>
          )}
          {s.nav && (
            <span className="muted">
              {s.nav.altitude_ft} ft{" "}
              {s.nav.altitude_selection
                ? `(auto: floor ${s.nav.altitude_selection.floor_ft} ft, ${s.nav.aircraft.name})`
                : "(you set this)"}
            </span>
          )}
          <span className="muted" style={{ marginLeft: "auto" }}>{s.showNav ? "hide" : "show"}</span>
        </div>
        {s.showNav && (
          <div id="navscroll">
            <table>
              <thead>
                <tr>
                  <th className="l">From</th><th className="l">To</th>
                  <th>Dist</th><th>TC</th><th>Wind</th><th>WCA</th>
                  <th>TH</th><th>Var</th><th>MH</th><th>GS</th><th>ETE</th><th>Fuel</th>
                </tr>
              </thead>
              <tbody>
                {s.navError && (
                  <tr><td className="l" colSpan={12} style={{ color: "var(--warn)" }}>{s.navError}</td></tr>
                )}
                {!s.navError && s.stage === "navlog" && (
                  <tr><td className="l muted" colSpan={12}>reading terrain, airspace and winds…</td></tr>
                )}
                {s.legs.map((l, i) => (
                  // A leg with no nearby winds-aloft station is a no-wind
                  // estimate, not a calm one. Shading keeps that visible
                  // rather than letting it read as a confident zero.
                  <tr key={i} className={l.wind ? undefined : "nowind"}>
                    <td className="l">{l.from}</td><td className="l">{l.to}</td>
                    <td>{l.distance_nm.toFixed(1)}</td>
                    <td>{deg(l.true_course_deg)}</td>
                    <td>{l.wind
                      ? `${deg(l.wind.wind_dir_true_deg)}/${Math.round(l.wind.wind_speed_kt)}`
                      : <span className="muted">no data</span>}</td>
                    <td>{signed(l.wca_deg)}</td>
                    <td>{deg(l.true_heading_deg)}</td>
                    <td>{signed(l.magnetic_variation_deg)}</td>
                    <td className="mh">{deg(l.magnetic_heading_deg)}</td>
                    <td>{l.groundspeed_kt === null
                      ? <span className="muted">—</span> : Math.round(l.groundspeed_kt)}</td>
                    <td>{l.ete_min === null
                      ? <span className="muted">unflyable</span> : one(l.ete_min)}</td>
                    <td>{one(l.fuel_gal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer>
        {/* One .frow, the same wrapper the labeling footer uses -- the
            footer itself is a column, so bare children stack. */}
        <div className="frow">
        <span className="legend">
          <span className="dot" style={{ background: "#1a7f37" }} />checkpoint (score-coloured)
        </span>
        <span className="legend">
          <span className="dot" style={{ background: "#96a7b2" }} />candidate considered
        </span>
        <span><kbd>a</kbd> candidates</span>
        <span><kbd>t</kbd> basemap: <b>{basemap}</b></span>
        <button type="button" className="viewbtn" onClick={() => controls.current?.fit()}>
          Fit route <kbd>f</kbd>
        </button>
        <span><kbd>n</kbd> nav log</span>
        </div>
      </footer>

      {s.error && <div id="flash" className="on bad"><span className="ftext">{s.error}</span></div>}
    </>
  );
}
