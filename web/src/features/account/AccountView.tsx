import { useCallback, useEffect, useState } from "react";
import CollapsibleSection from "../../components/CollapsibleSection";
import Footer from "../../components/Footer";
import PageHeader from "../../components/PageHeader";
import Button from "../../components/Button";
import { FIELD_INPUT as FIELD } from "../../components/fieldInput";
import { ApiError, api } from "../../lib/api/client";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import type { Aircraft, FlightSummary, Pilot } from "../../lib/api/types";

const ft = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()} ft`);

type PilotState = Pilot | null | "loading";

/**
 * Signed-in status, always visible (not a collapsible panel like the
 * rest of this page) -- it's identity, not content to skim past. A
 * 401 from `api.me()` is the ordinary signed-out case, not an error.
 * `pilot`/`refresh` are lifted to the parent rather than owned here,
 * since the Aircraft and Flights panels below also need to know
 * whether anyone's signed in.
 */
function SignInPanel({ pilot, refresh }: { pilot: PilotState; refresh: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 text-sm">
      {pilot === "loading" && <span className="text-slate-400">Checking sign-in…</span>}
      {pilot === null && <Button as="a" href="/oauth2/authorization/google">Sign in with Google</Button>}
      {pilot && pilot !== "loading" && (
        <>
          <span>
            Signed in as <span className="font-semibold">{pilot.displayName}</span>
          </span>
          <Button onClick={() => void api.logout().then(refresh)}>Log out</Button>
        </>
      )}
    </div>
  );
}

/** A signed-in pilot's own aeroplanes -- list, add, edit (the same
 *  form, switched into "editing" mode by clicking a row), delete.
 *  Nothing here means anything while signed out, so the panel says
 *  that plainly rather than showing an empty list that looks broken. */
function AircraftPanel({ pilot }: { pilot: PilotState }) {
  const [list, setList] = useState<Aircraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tailNumber, setTailNumber] = useState("");
  const [typeDesignator, setTypeDesignator] = useState("");
  const [cruiseTasKt, setCruiseTasKt] = useState("");
  const [fuelBurnGph, setFuelBurnGph] = useState("");

  const refresh = useCallback(() => {
    if (!pilot || pilot === "loading") return;
    api.aircraft.list().then(setList).catch(err => {
      setError(err instanceof ApiError ? err.message : "could not load your aircraft");
    });
  }, [pilot]);

  useEffect(refresh, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setTailNumber("");
    setTypeDesignator("");
    setCruiseTasKt("");
    setFuelBurnGph("");
  };

  const edit = (a: Aircraft) => {
    setEditingId(a.id);
    setTailNumber(a.tailNumber);
    setTypeDesignator(a.typeDesignator);
    setCruiseTasKt(String(a.cruiseTasKt));
    setFuelBurnGph(String(a.fuelBurnGph));
  };

  const submit = () => {
    const request = {
      tailNumber, typeDesignator,
      cruiseTasKt: Number(cruiseTasKt), fuelBurnGph: Number(fuelBurnGph),
    };
    const saved = editingId ? api.aircraft.update(editingId, request) : api.aircraft.add(request);
    saved.then(() => { resetForm(); refresh(); })
      .catch(err => setError(err instanceof ApiError ? err.message : "could not save the aircraft"));
  };

  if (pilot === null) {
    return (
      <CollapsibleSection title="Aircraft">
        <p className="text-sm text-slate-500">Sign in to manage your own aeroplanes.</p>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title="Aircraft">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {pilot === "loading" || !list ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="mb-3 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-4">Tail #</th>
                <th className="py-1 pr-4">Type</th>
                <th className="py-1 pr-4">Cruise TAS</th>
                <th className="py-1 pr-4">Fuel burn</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={5} className="py-1 text-slate-400">No aircraft yet.</td></tr>
              )}
              {list.map(a => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-1 pr-4 font-mono">{a.tailNumber}</td>
                  <td className="py-1 pr-4">{a.typeDesignator}</td>
                  <td className="py-1 pr-4">{a.cruiseTasKt} kt</td>
                  <td className="py-1 pr-4">{a.fuelBurnGph} gph</td>
                  <td className="py-1 whitespace-nowrap">
                    <button type="button" onClick={() => edit(a)} className="mr-2 text-blue-600 underline">Edit</button>
                    <button
                      type="button"
                      onClick={() => api.aircraft.remove(a.id).then(refresh)}
                      className="text-red-600 underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); submit(); }}>
        <input
          value={tailNumber} onChange={e => setTailNumber(e.target.value)} placeholder="Tail #"
          className={`w-24 ${FIELD}`}
        />
        <input
          value={typeDesignator} onChange={e => setTypeDesignator(e.target.value)} placeholder="Type (e.g. C172)"
          className={`w-32 ${FIELD}`}
        />
        <input
          value={cruiseTasKt} onChange={e => setCruiseTasKt(e.target.value)} placeholder="Cruise TAS (kt)"
          inputMode="decimal" className={`w-32 ${FIELD}`}
        />
        <input
          value={fuelBurnGph} onChange={e => setFuelBurnGph(e.target.value)} placeholder="Fuel burn (gph)"
          inputMode="decimal" className={`w-32 ${FIELD}`}
        />
        <Button type="submit">{editingId ? "Save changes" : "Add aircraft"}</Button>
        {editingId && <button type="button" onClick={resetForm} className="text-sm text-slate-500 underline">Cancel</button>}
      </form>
    </CollapsibleSection>
  );
}

/** A signed-in pilot's own filed flights -- read-only here (filing one
 *  happens from the Flight Briefing page's own "Save this flight"). */
function FlightsPanel({ pilot }: { pilot: PilotState }) {
  const [list, setList] = useState<FlightSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pilot || pilot === "loading") return;
    api.flights.list().then(setList).catch(err => {
      setError(err instanceof ApiError ? err.message : "could not load your flights");
    });
  }, [pilot]);

  if (pilot === null) {
    return (
      <CollapsibleSection title="My Flights">
        <p className="text-sm text-slate-500">Sign in to see flights you've filed.</p>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title="My Flights">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {pilot === "loading" || !list ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-slate-500">
          No flights filed yet -- plan a route, open its Flight Briefing, and save it there.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-4">Route</th>
                <th className="py-1 pr-4">Aircraft</th>
                <th className="py-1 pr-4">Altitude</th>
                <th className="py-1 pr-4">Distance</th>
                <th className="py-1 pr-4">Filed</th>
              </tr>
            </thead>
            <tbody>
              {list.map(f => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-1 pr-4 font-mono">{f.departureIdent} → {f.destinationIdent}</td>
                  <td className="py-1 pr-4">{f.aircraftTailNumber ?? "—"}</td>
                  <td className="py-1 pr-4">{ft(f.cruiseAltitudeFt)}</td>
                  <td className="py-1 pr-4">{f.totalDistanceNm == null ? "—" : `${f.totalDistanceNm.toFixed(1)} nm`}</td>
                  <td className="py-1 pr-4">{new Date(f.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

/**
 * A signed-in pilot's own data -- aeroplanes and filed flights. Split
 * out from Playground (which stays sign-in-free, stateless demos)
 * because "manage my own data" is a different intent from "explore
 * how the project works," not because they don't both fit under one
 * roof technically.
 */
export default function AccountView() {
  useDocumentTitle("Account — VFR Route");
  const [pilot, setPilot] = useState<PilotState>("loading");

  const refresh = useCallback(() => {
    setPilot("loading");
    void api.me().then(setPilot);
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-white">
      <PageHeader active="account" />
      <SignInPanel pilot={pilot} refresh={refresh} />
      <AircraftPanel pilot={pilot} />
      <FlightsPanel pilot={pilot} />
      <Footer />
    </div>
  );
}
