import { useEffect, useState } from "react";
import CollapsibleSection from "../../components/CollapsibleSection";
import Footer from "../../components/Footer";
import PageHeader from "../../components/PageHeader";
import StatusTag from "../../components/StatusTag";
import Button from "../../components/Button";
import { FIELD_INPUT as FIELD } from "../../components/fieldInput";
import { ApiError, api } from "../../lib/api/client";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import type { AltitudeBreakdown, ModelComparison, ScoredCheckpoint } from "../../lib/api/types";

const ft = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()} ft`);
const mae = (n: number) => n.toFixed(4);

/** Every algorithm anyone has actually trained for this problem, not
 *  just the sklearn family retrain() grid-searches -- PyTorch/
 *  TensorFlow/Spark's own candidates (vfr.model_candidates) show up
 *  here too once trained. Sorted best-first; each row names its own
 *  metric rather than implying they're all on the same footing (see
 *  the backend's own reasoning in planning-service's docstring). */
function ModelComparisonPanel() {
  const [data, setData] = useState<ModelComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.modelComparison().then(setData).catch(err => {
      setError(err instanceof ApiError ? err.message : "could not load the model comparison");
    });
  }, []);

  const rows = data ? [...data.models].sort((a, b) => a.score - b.score) : null;

  return (
    <CollapsibleSection title="Model Comparison">
      <p className="mb-2 text-sm text-slate-600">
        Mean absolute error on the {data?.n_labeled ?? "—"} hand-labeled checkpoints -- lower is
        better. Every algorithm this project has actually trained, not just the one serving
        predictions.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !rows && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && (
        <table className="text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-1 pr-4">Algorithm</th>
              <th className="py-1 pr-4">MAE</th>
              <th className="py-1 pr-4">Metric</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.name} className="border-b border-slate-100">
                <td className="py-1 pr-4">
                  {m.name}
                  {m.promoted && <span className="ml-2"><StatusTag tone="success">promoted</StatusTag></span>}
                </td>
                <td className="py-1 pr-4 font-mono">{mae(m.score)}</td>
                <td className="py-1 pr-4 text-slate-400">{m.metric === "cv_mae" ? "5-fold CV" : "held-out split"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleSection>
  );
}

/** Live scored checkpoints from one chosen algorithm -- calls the
 *  Playground's own /api/playground/score (not the planner's real
 *  scoring path, which never chooses an algorithm). Spark's own
 *  "model" here is a lookup into predictions computed once at
 *  training time, not a live Spark session -- see model-service's own
 *  docstring on why. */
function AlgorithmPickerPanel() {
  const [dep, setDep] = useState("C81");
  const [dest, setDest] = useState("KDLH");
  const [model, setModel] = useState("current");
  const [checkpoints, setCheckpoints] = useState<ScoredCheckpoint[] | null>(null);
  const [modelType, setModelType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    const d = dep.trim().toUpperCase(), a = dest.trim().toUpperCase();
    if (!d || !a) return;
    setLoading(true);
    setError(null);
    api.playgroundScore(d, a, model)
      .then(result => { setCheckpoints(result.checkpoints); setModelType(result.model_type); })
      .catch(err => setError(err instanceof ApiError ? err.message : "could not score this route"))
      .finally(() => setLoading(false));
  };

  return (
    <CollapsibleSection title="Algorithm Picker">
      <p className="mb-2 text-sm text-slate-600">
        The same route, scored by whichever algorithm you pick -- real inference each time
        (Spark's own "model" is a lookup into predictions it computed once at training time, not
        a live Spark session; see the Model Comparison panel above for its own accuracy).
      </p>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); run(); }}>
        <input
          value={dep} onChange={e => setDep(e.target.value)} placeholder="DEP" spellCheck={false}
          aria-label="Departure" className={`w-20 text-center font-mono uppercase ${FIELD}`}
        />
        <span>→</span>
        <input
          value={dest} onChange={e => setDest(e.target.value)} placeholder="DEST" spellCheck={false}
          aria-label="Destination" className={`w-20 text-center font-mono uppercase ${FIELD}`}
        />
        <select value={model} onChange={e => setModel(e.target.value)} aria-label="Algorithm" className={FIELD}>
          <option value="current">Currently promoted</option>
          <option value="pytorch">PyTorch MLP</option>
          <option value="tensorflow">TensorFlow MLP</option>
          <option value="spark">Spark GBT</option>
        </select>
        <Button type="submit" disabled={loading}>{loading ? "Scoring…" : "Score checkpoints"}</Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {checkpoints && (
        <>
          <p className="mb-1 text-xs text-slate-500">Scored by: {modelType}</p>
          <table className="text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-4">Checkpoint</th>
                <th className="py-1 pr-4">Category</th>
                <th className="py-1 pr-4">Along track</th>
                <th className="py-1 pr-4">Score</th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.map(c => (
                <tr key={c.osm_id} className="border-b border-slate-100">
                  <td className="py-1 pr-4">{c.name}</td>
                  <td className="py-1 pr-4">{c.category}</td>
                  <td className="py-1 pr-4">{c.along_track_nm.toFixed(1)} nm</td>
                  <td className="py-1 pr-4 font-mono">{c.predicted_score.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </CollapsibleSection>
  );
}

/** The full reasoning behind one recommended cruise altitude for any
 *  route -- not just the final number, every constraint that produced
 *  it. */
function AltitudeBreakdownPanel() {
  const [dep, setDep] = useState("C81");
  const [dest, setDest] = useState("KDLH");
  const [result, setResult] = useState<AltitudeBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    const d = dep.trim().toUpperCase(), a = dest.trim().toUpperCase();
    if (!d || !a) return;
    setLoading(true);
    setError(null);
    api.altitudeBreakdown(d, a)
      .then(setResult)
      .catch(err => setError(err instanceof ApiError ? err.message : "could not compute the breakdown"))
      .finally(() => setLoading(false));
  };

  return (
    <CollapsibleSection title="Altitude Selection Breakdown">
      <p className="mb-2 text-sm text-slate-600">
        Everything that goes into one recommended cruise altitude -- not just the final number.
      </p>
      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={e => { e.preventDefault(); run(); }}
      >
        <input
          value={dep} onChange={e => setDep(e.target.value)} placeholder="DEP" spellCheck={false}
          aria-label="Departure" className={`w-20 text-center font-mono uppercase ${FIELD}`}
        />
        <span>→</span>
        <input
          value={dest} onChange={e => setDest(e.target.value)} placeholder="DEST" spellCheck={false}
          aria-label="Destination" className={`w-20 text-center font-mono uppercase ${FIELD}`}
        />
        <Button type="submit" disabled={loading}>{loading ? "Computing…" : "Show breakdown"}</Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-400">Recommended</div>
            <div className="font-semibold">{ft(result.recommended_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Terrain/obstacle floor</div>
            <div className="font-semibold">{ft(result.floor_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Airspace ceiling</div>
            <div className="font-semibold">{ft(result.airspace_ceiling_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Freezing level</div>
            <div className="font-semibold">{ft(result.freezing_level_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Combined ceiling band</div>
            <div className="font-semibold">{ft(result.band_ceiling_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Forecast ceiling/visibility</div>
            <div className="font-semibold">
              {ft(result.min_ceiling_ft)}, {result.min_visibility_sm ?? "—"} sm
              {result.low_ceiling_or_visibility && (
                <span className="ml-1"><StatusTag tone="warning">low</StatusTag></span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Hazards along route</div>
            <div className="font-semibold">{result.hazards.length === 0 ? "none" : result.hazards.length}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Airspace transits</div>
            <div className="font-semibold">{result.airspace_transits.length === 0 ? "none" : result.airspace_transits.length}</div>
          </div>
          {result.airspace_transits.length > 0 && (
            <ul className="col-span-full mt-1 space-y-0.5 text-xs text-slate-500">
              {result.airspace_transits.map((t, i) => (
                <li key={i}>
                  {t.name} (Class {t.class}), floor {ft(t.floor_ft_msl)}, {t.along_track_nm} nm along route --
                  requires {t.requires}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

/**
 * The stateless "explore how this project works" demos -- how the
 * served model was actually chosen versus its alternatives, live
 * scoring from any of them, and the full reasoning behind a
 * recommended cruise altitude. Nothing here needs a pilot signed in;
 * that's Account's own page (aircraft, filed flights), split out from
 * this one on the grounds that "explore the project" and "manage my
 * own data" are different enough intents to deserve different pages.
 */
export default function PlaygroundView() {
  useDocumentTitle("Playground — VFR Route");
  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-white">
      <PageHeader active="playground" />
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-500">How this project actually works, underneath the map.</p>
      </div>
      <ModelComparisonPanel />
      <AlgorithmPickerPanel />
      <AltitudeBreakdownPanel />
      <Footer />
    </div>
  );
}
