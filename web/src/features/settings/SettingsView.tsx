import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ListChecks } from "lucide-react";
import CollapsibleSection from "../../components/CollapsibleSection";
import Footer from "../../components/Footer";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Field, FieldError } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import SignInModal from "./SignInModal";
import { ApiError, api } from "../../lib/api/client";
import { identSchema } from "../../lib/identSchema";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import type { Aircraft, AircraftRequest, Pilot } from "../../lib/api/types";

/** Introduces the "explore the project" panels below (Model Comparison
 *  through Altitude Breakdown) -- was its own Dev page's intro row
 *  before Dev folded into Settings, now the same nav item as
 *  everything else here. Label isn't its own top-nav link -- it's the
 *  one other page a developer poking at this project actually wants
 *  (the training-data side of the model these panels explore), so
 *  it's linked from here instead of adding it to the header. */
function DevIntro() {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
      <p className="text-sm text-muted-foreground">How this project actually works, underneath the map.</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/label">
          <ListChecks />
          Label checkpoints
        </Link>
      </Button>
    </div>
  );
}

/** A named group of panels -- Account, Developer tools -- rather than
 *  one flat stack where a pilot's own aircraft sat between an
 *  algorithm picker and a marketing blurb with nothing marking any of
 *  it apart. Small-caps muted label, the same convention Label's own
 *  toolbar already uses for "Route"/"View" ("settings page UX best
 *  practices": grouping by category and labeling the groups is what
 *  makes a page like this scannable rather than a flat list to hunt
 *  through -- see https://baymard.com/blog/current-state-accounts-selfservice
 *  and https://www.setproduct.com/blog/settings-ui-design). */
function SectionHeading({ children }: { children: string }) {
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

const ft = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()} ft`);
const mae = (n: number) => n.toFixed(4);

type PilotState = Pilot | null | "loading";

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : err ? fallback : null;

/** Every algorithm anyone has actually trained for this problem, not
 *  just the sklearn family retrain() grid-searches -- PyTorch/
 *  TensorFlow/Spark's own candidates (vfr.model_candidates) show up
 *  here too once trained. Sorted best-first; each row names its own
 *  metric rather than implying they're all on the same footing (see
 *  the backend's own reasoning in planning-service's docstring). */
function ModelComparisonPanel() {
  const { data, error } = useQuery({ queryKey: ["modelComparison"], queryFn: api.modelComparison });
  const rows = data ? [...data.models].sort((a, b) => a.score - b.score) : null;

  return (
    <CollapsibleSection title="Model Comparison">
      <p className="mb-2 text-sm text-muted-foreground">
        Mean absolute error on the {data?.n_labeled ?? "—"} hand-labeled checkpoints -- lower is
        better. Every algorithm this project has actually trained, not just the one serving
        predictions.
      </p>
      {errorMessage(error, "could not load the model comparison") && (
        <p className="text-sm text-destructive">{errorMessage(error, "could not load the model comparison")}</p>
      )}
      {!error && !rows && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows && (
        <table className="text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-4">Algorithm</th>
              <th className="py-1 pr-4">MAE</th>
              <th className="py-1 pr-4">Metric</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.name} className="border-b border-border">
                <td className="py-1 pr-4">
                  {m.name}
                  {m.promoted && (
                    <Badge className="ml-2 border-transparent bg-emerald-100 text-emerald-700">promoted</Badge>
                  )}
                </td>
                <td className="py-1 pr-4 font-mono">{mae(m.score)}</td>
                <td className="py-1 pr-4 text-muted-foreground">{m.metric === "cv_mae" ? "5-fold CV" : "held-out split"}</td>
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
  const score = useMutation({
    mutationFn: ({ d, a, m }: { d: string; a: string; m: string }) => api.playgroundScore(d, a, m),
  });

  const run = () => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a) return;
    score.mutate({ d, a, m: model });
  };

  return (
    <CollapsibleSection title="Algorithm Picker">
      <p className="mb-2 text-sm text-muted-foreground">
        The same route, scored by whichever algorithm you pick -- real inference each time
        (Spark's own "model" is a lookup into predictions it computed once at training time, not
        a live Spark session; see the Model Comparison panel above for its own accuracy).
      </p>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); run(); }}>
        <Input
          value={dep} onChange={e => setDep(e.target.value)} placeholder="DEP" spellCheck={false}
          aria-label="Departure" className="w-20 text-center font-mono uppercase"
        />
        <span>→</span>
        <Input
          value={dest} onChange={e => setDest(e.target.value)} placeholder="DEST" spellCheck={false}
          aria-label="Destination" className="w-20 text-center font-mono uppercase"
        />
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger aria-label="Algorithm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Currently promoted</SelectItem>
            <SelectItem value="pytorch">PyTorch MLP</SelectItem>
            <SelectItem value="tensorflow">TensorFlow MLP</SelectItem>
            <SelectItem value="spark">Spark GBT</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={score.isPending}>{score.isPending ? "Scoring…" : "Score checkpoints"}</Button>
      </form>
      {errorMessage(score.error, "could not score this route") && (
        <p className="text-sm text-destructive">{errorMessage(score.error, "could not score this route")}</p>
      )}
      {score.data && (
        <>
          <p className="mb-1 text-xs text-muted-foreground">Scored by: {score.data.model_type}</p>
          <table className="text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-4">Checkpoint</th>
                <th className="py-1 pr-4">Category</th>
                <th className="py-1 pr-4">Along track</th>
                <th className="py-1 pr-4">Score</th>
              </tr>
            </thead>
            <tbody>
              {score.data.checkpoints.map(c => (
                <tr key={c.osm_id} className="border-b border-border">
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
  const breakdown = useMutation({
    mutationFn: ({ d, a }: { d: string; a: string }) => api.altitudeBreakdown(d, a),
  });

  const run = () => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a) return;
    breakdown.mutate({ d, a });
  };

  const result = breakdown.data;

  return (
    <CollapsibleSection title="Altitude Selection Breakdown">
      <p className="mb-2 text-sm text-muted-foreground">
        Everything that goes into one recommended cruise altitude -- not just the final number.
      </p>
      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={e => { e.preventDefault(); run(); }}
      >
        <Input
          value={dep} onChange={e => setDep(e.target.value)} placeholder="DEP" spellCheck={false}
          aria-label="Departure" className="w-20 text-center font-mono uppercase"
        />
        <span>→</span>
        <Input
          value={dest} onChange={e => setDest(e.target.value)} placeholder="DEST" spellCheck={false}
          aria-label="Destination" className="w-20 text-center font-mono uppercase"
        />
        <Button type="submit" disabled={breakdown.isPending}>{breakdown.isPending ? "Computing…" : "Show breakdown"}</Button>
      </form>
      {errorMessage(breakdown.error, "could not compute the breakdown") && (
        <p className="text-sm text-destructive">{errorMessage(breakdown.error, "could not compute the breakdown")}</p>
      )}
      {result && (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Recommended</div>
            <div className="font-semibold">{ft(result.recommended_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Terrain/obstacle floor</div>
            <div className="font-semibold">{ft(result.floor_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Airspace ceiling</div>
            <div className="font-semibold">{ft(result.airspace_ceiling_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Freezing level</div>
            <div className="font-semibold">{ft(result.freezing_level_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Combined ceiling band</div>
            <div className="font-semibold">{ft(result.band_ceiling_ft)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Forecast ceiling/visibility</div>
            <div className="font-semibold">
              {ft(result.min_ceiling_ft)}, {result.min_visibility_sm ?? "—"} sm
              {result.low_ceiling_or_visibility && (
                <Badge className="ml-1 border-transparent bg-amber-100 text-amber-700">low</Badge>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Hazards along route</div>
            <div className="font-semibold">{result.hazards.length === 0 ? "none" : result.hazards.length}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Airspace transits</div>
            <div className="font-semibold">{result.airspace_transits.length === 0 ? "none" : result.airspace_transits.length}</div>
          </div>
          {result.airspace_transits.length > 0 && (
            <ul className="col-span-full mt-1 space-y-0.5 text-xs text-muted-foreground">
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

// Mirrors springboot-app's own AircraftRequest validation
// (@NotBlank/@Positive in dto/AircraftRequest.java) so a bad value is
// caught before the round trip, not just after. Fields stay strings
// through validation (matching what a plain <input> actually holds)
// -- the numeric conversion happens once, building the request body in
// onSubmit below, rather than fighting react-hook-form's generics over
// a coerced form-value type.
const aircraftSchema = z.object({
  tailNumber: z.string().min(1, "Tail number is required"),
  typeDesignator: z.string().min(1, "Type designator is required"),
  cruiseTasKt: z.string().refine(v => Number(v) > 0, "Cruise TAS must be a positive number"),
  fuelBurnGph: z.string().refine(v => Number(v) > 0, "Fuel burn must be a positive number"),
});
type AircraftFormValues = z.infer<typeof aircraftSchema>;
const EMPTY_AIRCRAFT_FORM: AircraftFormValues = {
  tailNumber: "", typeDesignator: "", cruiseTasKt: "", fuelBurnGph: "",
};

/**
 * Signed-in status, in the header's own top-right corner rather than a
 * full-width row in the page body -- identity reads as chrome, the same
 * place any other app puts it, not content to scroll past. `pilot` is
 * lifted to the parent rather than owned here, since the Aircraft and
 * Flights panels below also need to know whether anyone's signed in;
 * the ["pilot"] query itself is shared cache, not re-fetched per panel.
 * Signed out, this is just `SignInModal`'s own trigger button -- the
 * three-provider prompt lives entirely in that component.
 */
function SignInStatus({ pilot }: { pilot: PilotState }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pilot"] }),
  });

  if (pilot === "loading") {
    return <span className="text-sm text-muted-foreground">Checking sign-in…</span>;
  }
  if (pilot === null) {
    return <SignInModal />;
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        Signed in as <span className="font-semibold text-foreground">{pilot.displayName}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Log out
      </Button>
    </div>
  );
}

/** A signed-in pilot's own aeroplanes -- list, add, edit (the same
 *  form, switched into "editing" mode by clicking a row), delete.
 *  Nothing here means anything while signed out, so the panel says
 *  that plainly rather than showing an empty list that looks broken. */
function AircraftPanel({ pilot }: { pilot: PilotState }) {
  const signedIn = pilot !== null && pilot !== "loading";
  const queryClient = useQueryClient();
  const { data: list, isLoading, error: listError } = useQuery({
    queryKey: ["aircraft"],
    queryFn: api.aircraft.list,
    enabled: signedIn,
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<AircraftFormValues>({
    resolver: zodResolver(aircraftSchema),
    defaultValues: EMPTY_AIRCRAFT_FORM,
  });

  const cancelEdit = () => {
    setEditingId(null);
    reset(EMPTY_AIRCRAFT_FORM);
  };

  const save = useMutation({
    mutationFn: (request: AircraftRequest) =>
      editingId ? api.aircraft.update(editingId, request) : api.aircraft.add(request),
    // The only other feedback a save gets is a row quietly changing in
    // a table below the form -- easy to miss with your eyes still on
    // the inputs you just submitted, unlike Plan/Label's own toasts
    // (usePageStatus), which confirm something already big and visible
    // (a route, a rating). This is the one place in the app a genuine
    // list-editing success has nothing else to announce it.
    onSuccess: () => {
      toast.success(editingId ? "Aircraft updated" : "Aircraft added");
      cancelEdit();
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.aircraft.remove(id),
    onSuccess: () => {
      toast.success("Aircraft deleted");
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
  });

  const edit = (a: Aircraft) => {
    setEditingId(a.id);
    reset({
      tailNumber: a.tailNumber, typeDesignator: a.typeDesignator,
      cruiseTasKt: String(a.cruiseTasKt), fuelBurnGph: String(a.fuelBurnGph),
    });
  };

  const onSubmit = (values: AircraftFormValues) => save.mutate({
    tailNumber: values.tailNumber, typeDesignator: values.typeDesignator,
    cruiseTasKt: Number(values.cruiseTasKt), fuelBurnGph: Number(values.fuelBurnGph),
  });

  if (pilot === null) {
    return (
      <CollapsibleSection title="Aircraft">
        <p className="text-sm text-muted-foreground">Sign in to manage your own aeroplanes.</p>
      </CollapsibleSection>
    );
  }

  const banner = errorMessage(listError, "could not load your aircraft")
    ?? errorMessage(save.error, "could not save the aircraft")
    ?? errorMessage(remove.error, "could not delete the aircraft");

  return (
    <CollapsibleSection title="Aircraft">
      {banner && <p className="mb-2 text-sm text-destructive">{banner}</p>}
      {pilot === "loading" || isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mb-3 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-4">Tail #</th>
                <th className="py-1 pr-4">Type</th>
                <th className="py-1 pr-4">Cruise TAS</th>
                <th className="py-1 pr-4">Fuel burn</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {list?.length === 0 && (
                <tr><td colSpan={5} className="py-1 text-muted-foreground">No aircraft yet.</td></tr>
              )}
              {list?.map(a => (
                <tr key={a.id} className="border-b border-border">
                  <td className="py-1 pr-4 font-mono">{a.tailNumber}</td>
                  <td className="py-1 pr-4">{a.typeDesignator}</td>
                  <td className="py-1 pr-4">{a.cruiseTasKt} kt</td>
                  <td className="py-1 pr-4">{a.fuelBurnGph} gph</td>
                  <td className="py-1 whitespace-nowrap">
                    <button type="button" onClick={() => edit(a)} className="mr-2 text-blue-600 underline">Edit</button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(a.id)}
                      className="text-destructive underline"
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
      <form className="flex flex-wrap items-start gap-2" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field data-invalid={!!errors.tailNumber} className="w-24">
          <Input
            {...register("tailNumber")} placeholder="Tail #"
            aria-label="Tail number" aria-invalid={!!errors.tailNumber}
          />
          <FieldError errors={[errors.tailNumber]} />
        </Field>
        <Field data-invalid={!!errors.typeDesignator} className="w-32">
          <Input
            {...register("typeDesignator")} placeholder="Type (e.g. C172)"
            aria-label="Type designator" aria-invalid={!!errors.typeDesignator}
          />
          <FieldError errors={[errors.typeDesignator]} />
        </Field>
        <Field data-invalid={!!errors.cruiseTasKt} className="w-32">
          <Input
            {...register("cruiseTasKt")} placeholder="Cruise TAS (kt)"
            aria-label="Cruise TAS in knots" inputMode="decimal" aria-invalid={!!errors.cruiseTasKt}
          />
          <FieldError errors={[errors.cruiseTasKt]} />
        </Field>
        <Field data-invalid={!!errors.fuelBurnGph} className="w-32">
          <Input
            {...register("fuelBurnGph")} placeholder="Fuel burn (gph)"
            aria-label="Fuel burn in gallons per hour" inputMode="decimal" aria-invalid={!!errors.fuelBurnGph}
          />
          <FieldError errors={[errors.fuelBurnGph]} />
        </Field>
        <Button type="submit" disabled={save.isPending}>{editingId ? "Save changes" : "Add aircraft"}</Button>
        {editingId && <button type="button" onClick={cancelEdit} className="text-sm text-muted-foreground underline">Cancel</button>}
      </form>
    </CollapsibleSection>
  );
}

/** A signed-in pilot's own filed flights -- read-only here (filing one
 *  happens from the Flight Briefing page's own "Save this flight"). */
function FlightsPanel({ pilot }: { pilot: PilotState }) {
  const signedIn = pilot !== null && pilot !== "loading";
  const { data: list, isLoading, error } = useQuery({
    queryKey: ["flights"],
    queryFn: api.flights.list,
    enabled: signedIn,
  });

  if (pilot === null) {
    return (
      <CollapsibleSection title="My Flights">
        <p className="text-sm text-muted-foreground">Sign in to see flights you've filed.</p>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title="My Flights">
      {errorMessage(error, "could not load your flights") && (
        <p className="text-sm text-destructive">{errorMessage(error, "could not load your flights")}</p>
      )}
      {pilot === "loading" || isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No flights filed yet -- plan a route, open its Flight Briefing, and save it there.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-4">Route</th>
                <th className="py-1 pr-4">Aircraft</th>
                <th className="py-1 pr-4">Altitude</th>
                <th className="py-1 pr-4">Distance</th>
                <th className="py-1 pr-4">Filed</th>
              </tr>
            </thead>
            <tbody>
              {list?.map(f => (
                <tr key={f.id} className="border-b border-border">
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
 * Where the gear that led here should lead back to -- the map, the
 * Flight Briefing sub-view, or Label, matching whichever one actually
 * sent the pilot here (`SettingsButton`'s own `state.from`) rather than
 * always landing back on the plain map view regardless of where they
 * started. No state at all (Settings opened directly, a bookmark or a
 * fresh tab) falls back to the map -- always a valid destination, never
 * a dead link.
 */
function backDestination(from: string | undefined): { to: string; label: string } {
  if (!from) return { to: "/plan", label: "Back to Map" };
  if (from.includes("view=briefing")) return { to: from, label: "Back to Brief" };
  if (from.startsWith("/label")) return { to: from, label: "Back to Label" };
  return { to: from, label: "Back to Map" };
}

/**
 * Everything that isn't the map, grouped rather than one flat stack
 * (see `SectionHeading`'s own comment for why): a signed-in pilot's own
 * data (aeroplanes, filed flights) first -- the actual reason a
 * "Settings" page's own gear icon exists, and standard UX research on
 * settings pages agrees the frequently-needed content belongs at the
 * top, not buried under three developer demos -- then what the app
 * does (moved here from the old standalone Home page once Plan became
 * the homepage), then the stateless "explore how this project works"
 * demos (moved here from the old standalone Dev page -- model
 * comparison, algorithm picker, altitude breakdown, none of it needing
 * a pilot signed in) last, under their own "Developer tools" heading
 * rather than mixed in with account data. One page behind the header's
 * own gear icon now, not three behind three separate nav items -- Plan
 * is the only page anyone opens this app to actually use; everything
 * else here is either read-only context or an occasional errand.
 */
export default function SettingsView() {
  useDocumentTitle("Settings — VFR Route");
  const { data: pilot, isLoading } = useQuery({ queryKey: ["pilot"], queryFn: api.me });
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? null);
  const location = useLocation();
  const back = backDestination((location.state as { from?: string } | null)?.from);

  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-background">
      {/* Not the shared PageHeader ("VFR Route" + the gear that would
          point right back here) -- a bare back button reads better
          once you're already on the page the gear leads to; nothing
          else on this page is worth a second header row for.
          justify-between: the back button on the left, sign-in status
          (or the Sign in prompt itself) on the right -- the one other
          thing in this app's own top-right corner slot, the same one
          the Settings gear itself occupies everywhere else. */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to={back.to}>
            <ArrowLeft className="size-4" />
            {back.label}
          </Link>
        </Button>
        <SignInStatus pilot={pilotState} />
      </header>
      <SectionHeading>Account</SectionHeading>
      <AircraftPanel pilot={pilotState} />
      <FlightsPanel pilot={pilotState} />
      <SectionHeading>Developer tools</SectionHeading>
      <DevIntro />
      <ModelComparisonPanel />
      <AlgorithmPickerPanel />
      <AltitudeBreakdownPanel />
      <Footer />
    </div>
  );
}
