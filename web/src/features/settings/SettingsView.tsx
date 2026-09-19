import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Link, useLocation } from "react-router-dom";
import { FlaskConical, Map as MapIcon } from "lucide-react";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import Shell from "../../Shell";
import CollapsibleSection from "../../components/CollapsibleSection";
import Footer from "../../components/Footer";
import IdentPairInputs from "../../components/IdentPairInputs";
import SidebarToggleButton from "../../components/SidebarToggleButton";
import TwoRowHeader from "../../components/TwoRowHeader";
import { Button } from "../../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { Field, FieldError } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../../components/ui/sheet";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import { TabsTrigger } from "../../components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import LabelView from "../label/LabelView";
import SignInModal from "./SignInModal";
import { ApiError, api } from "../../lib/api/client";
import { identSchema } from "../../lib/identSchema";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import type { Aircraft, AircraftRequest, ModelComparisonEntry, Pilot } from "../../lib/api/types";

const ft = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()} ft`);
const mae = (n: number) => n.toFixed(4);

type PilotState = Pilot | null | "loading" | "error";

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : err ? fallback : null;

function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}

/** Every algorithm anyone has actually trained for this problem, not
 *  just the sklearn family retrain() grid-searches -- PyTorch/
 *  TensorFlow/Spark's own candidates (vfr.model_candidates) show up
 *  here too once trained. Sorted best-first; each row names its own
 *  metric rather than implying they're all on the same footing (see
 *  the backend's own reasoning in planning-service's docstring). */
const modelComparisonChartConfig = {
  score: { label: "MAE", color: "var(--chart-1)" },
} satisfies ChartConfig;

// Emerald, matching the promoted Badge's own color elsewhere in this app
// (e.g. the Plan tab's own algorithm badges) -- the one bar that's
// actually serving predictions reads as such at a glance, not just on
// hover.
const PROMOTED_BAR_COLOR = "#10b981";

function ModelComparisonPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    data, error, refetch,
  } = useQuery({ queryKey: ["modelComparison"], queryFn: api.modelComparison, enabled: isOpen });
  const rows = data ? [...data.models].sort((a, b) => a.score - b.score) : null;

  return (
    <CollapsibleSection title="Model Comparison" onOpenChange={setIsOpen}>
      <p className="mb-2 text-sm text-muted-foreground">
        Mean absolute error on the {data?.n_labeled ?? "—"} hand-labeled checkpoints -- lower is
        better. Every algorithm this project has actually trained, not just the one serving
        predictions.
      </p>
      {errorMessage(error, "Could not load the model comparison") && (
        <QueryError
          message={errorMessage(error, "Could not load the model comparison")!}
          onRetry={() => void refetch()}
        />
      )}
      {!error && !rows && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">No trained models are available.</p>}
      {rows && rows.length > 0 && (
        <ChartContainer
          config={modelComparisonChartConfig}
          className="aspect-auto w-full max-w-xl"
          style={{ height: Math.max(rows.length * 36, 120) }}
        >
          <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 12 }}>
            <XAxis type="number" dataKey="score" hide />
            <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tickMargin={8} width={110} />
            <ChartTooltip
              cursor={false}
              content={(
                <ChartTooltipContent
                  formatter={(value, _name, item) => (
                    <div className="flex w-full items-center gap-2">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                      <span className="text-muted-foreground">MAE</span>
                      <div className="ml-auto flex items-baseline gap-1 font-mono font-medium text-foreground tabular-nums">
                        {mae(Number(value))}
                        <span className="font-sans font-normal text-muted-foreground">
                          {(item.payload as ModelComparisonEntry).metric === "cv_mae" ? "CV" : "held-out"}
                        </span>
                      </div>
                    </div>
                  )}
                />
              )}
            />
            <Bar dataKey="score" radius={4}>
              {rows.map(m => (
                <Cell key={m.name} fill={m.promoted ? PROMOTED_BAR_COLOR : "var(--color-score)"} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
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
  const [routeError, setRouteError] = useState<string | null>(null);
  const score = useMutation({
    mutationFn: ({ d, a, m }: { d: string; a: string; m: string }) => api.playgroundScore(d, a, m),
  });

  const run = () => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a) {
      setRouteError("Enter valid departure and destination airport identifiers.");
      return;
    }
    setRouteError(null);
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
        <IdentPairInputs
          dep={dep} dest={dest}
          onDepChange={v => { setDep(v); setRouteError(null); }}
          onDestChange={v => { setDest(v); setRouteError(null); }}
          invalid={!!routeError} widthClassName="w-20"
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
      {routeError && <p className="text-sm text-destructive" role="alert">{routeError}</p>}
      {errorMessage(score.error, "Could not score this route") && (
        <QueryError message={errorMessage(score.error, "Could not score this route")!} onRetry={run} />
      )}
      {score.data && (
        <>
          <p className="mb-1 text-xs text-muted-foreground">Scored by: {score.data.model_type}</p>
          {score.data.checkpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checkpoints were returned for this route.</p>
          ) : (
            <Table className="min-w-[32rem]">
              <TableCaption className="sr-only">Scored checkpoints</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-1 pr-4 pl-0">Checkpoint</TableHead>
                  <TableHead className="py-1 pr-4">Category</TableHead>
                  <TableHead className="py-1 pr-4">Along track</TableHead>
                  <TableHead className="py-1 pr-4">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {score.data.checkpoints.map(c => (
                  <TableRow key={c.osm_id}>
                    <TableCell className="py-1 pr-4 pl-0">{c.name}</TableCell>
                    <TableCell className="py-1 pr-4">{c.category}</TableCell>
                    <TableCell className="py-1 pr-4">{c.along_track_nm.toFixed(1)} nm</TableCell>
                    <TableCell className="py-1 pr-4 font-mono">{c.predicted_score.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

/** Model Comparison and Algorithm Picker, in a top drawer off the Dev
 *  tab rather than a tab of their own -- they're both stateless
 *  "explore how this project's model selection actually works" demos
 *  (moved here from the old standalone Dev page), not something a
 *  pilot planning a real flight needs on screen by default the way
 *  this tab's own live labeling workspace is the actual point of it.
 *  Top, not bottom -- this tab's own map fills the rest of the screen
 *  below the header, the same reason every other sheet/popover in this
 *  app that isn't the mobile sidebar opens from the top or inline
 *  rather than a bottom edge nothing else in this app anchors to.
 *  Altitude Selection Breakdown and Agent Framework Comparison
 *  used to live here too; the first moved to the Brief tab (it's about
 *  the route a pilot actually has open, not a one-off lookup), the
 *  second was dropped outright (the Brief tab's own AI popover already
 *  offers the same LangGraph/CrewAI choice, one framework at a time,
 *  right where a pilot would use the result). */
function DevMlDrawer() {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Dev ML">
              <FlaskConical className="size-5" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Dev ML</TooltipContent>
      </Tooltip>
      {/* mx-auto max-w-2xl -- stock Sheet only caps width for the
          left/right sides (the top/bottom sides ship `inset-x-0` alone,
          full-bleed); this content's own widest piece (the model
          comparison table) tops out around 32rem, so 2xl leaves it
          comfortable room without spanning the whole screen behind it. */}
      <SheetContent side="top" className="mx-auto max-w-2xl">
        <ScrollArea className="max-h-[85vh]">
          <SheetHeader>
            <SheetTitle>Dev ML</SheetTitle>
            <SheetDescription>How this project actually works, underneath the map.</SheetDescription>
          </SheetHeader>
          <ModelComparisonPanel />
          <AlgorithmPickerPanel />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// Mirrors springboot-app's own AircraftRequest validation
// (@NotBlank/@Positive in dto/AircraftRequest.java) so a bad value is
// caught before the round trip, not just after. Fields stay strings
// through validation (matching what a plain <input> actually holds)
// -- the numeric conversion happens once, building the request body in
// onSubmit below, rather than fighting react-hook-form's generics over
// a coerced form-value type.
const positiveNumber = (label: string) => z.string().trim().refine(
  value => Number.isFinite(Number(value)) && Number(value) > 0,
  `${label} must be a positive number`,
);

const aircraftSchema = z.object({
  tailNumber: z.string().trim().min(1, "Tail number is required"),
  typeDesignator: z.string().trim().min(1, "Type designator is required"),
  cruiseTasKt: positiveNumber("Cruise TAS"),
  fuelBurnGph: positiveNumber("Fuel burn"),
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
function SignInStatus({ pilot, onRetry }: { pilot: PilotState; onRetry: () => void }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.setQueryData(["pilot"], null);
      queryClient.removeQueries({ queryKey: ["aircraft"] });
      queryClient.removeQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
    onError: () => toast.error("Couldn't log out. Try again."),
  });

  if (pilot === "loading") {
    return <span className="text-sm text-muted-foreground">Checking sign-in…</span>;
  }
  if (pilot === "error") {
    return <Button variant="outline" size="sm" onClick={onRetry}>Retry sign-in check</Button>;
  }
  if (pilot === null) {
    return <SignInModal />;
  }
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="truncate text-muted-foreground" title={`Signed in as ${pilot.displayName}`}>
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
  const signedIn = pilot !== null && pilot !== "loading" && pilot !== "error";
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const {
    data: list, isLoading, error: listError, refetch,
  } = useQuery({
    queryKey: ["aircraft"],
    queryFn: api.aircraft.list,
    enabled: signedIn && isOpen,
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [aircraftToDelete, setAircraftToDelete] = useState<Aircraft | null>(null);
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
    onSuccess: (_data, id) => {
      toast.success("Aircraft deleted");
      setAircraftToDelete(null);
      if (editingId === id) cancelEdit();
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
    tailNumber: values.tailNumber.trim(), typeDesignator: values.typeDesignator.trim(),
    cruiseTasKt: Number(values.cruiseTasKt), fuelBurnGph: Number(values.fuelBurnGph),
  });

  if (pilot === null || pilot === "error") {
    return (
      <CollapsibleSection title="Aircraft">
        <p className="text-sm text-muted-foreground">
          {pilot === "error" ? "Your sign-in status could not be checked." : "Sign in to manage your own aeroplanes."}
        </p>
      </CollapsibleSection>
    );
  }

  const listMessage = errorMessage(listError, "Could not load your aircraft");
  const mutationMessage = errorMessage(save.error, "Could not save the aircraft")
    ?? errorMessage(remove.error, "Could not delete the aircraft");

  return (
    <CollapsibleSection title="Aircraft" onOpenChange={setIsOpen}>
      {listMessage && (
        <QueryError message={listMessage} onRetry={() => void refetch()} />
      )}
      {mutationMessage && <p className="mb-2 text-sm text-destructive" role="alert">{mutationMessage}</p>}
      {pilot === "loading" || isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list ? (
        <Table containerClassName="mb-3" className="min-w-[34rem]">
          <TableCaption className="sr-only">Your saved aircraft</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="py-1 pr-4 pl-0">Tail #</TableHead>
              <TableHead className="py-1 pr-4">Type</TableHead>
              <TableHead className="py-1 pr-4">Cruise TAS</TableHead>
              <TableHead className="py-1 pr-4">Fuel burn</TableHead>
              <TableHead className="py-1"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list?.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-1 pl-0 text-muted-foreground">No aircraft yet.</TableCell></TableRow>
            )}
            {list?.map(a => (
              <TableRow key={a.id}>
                <TableCell className="py-1 pr-4 pl-0 font-mono">{a.tailNumber}</TableCell>
                <TableCell className="py-1 pr-4">{a.typeDesignator}</TableCell>
                <TableCell className="py-1 pr-4">{a.cruiseTasKt} kt</TableCell>
                <TableCell className="py-1 pr-4">{a.fuelBurnGph} gph</TableCell>
                <TableCell className="py-1 whitespace-nowrap">
                  <Button type="button" variant="link" size="sm" onClick={() => edit(a)}>Edit</Button>
                  <Button type="button" variant="link" size="sm" className="text-destructive" onClick={() => setAircraftToDelete(a)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {aircraftToDelete && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
          <p>Delete {aircraftToDelete.tailNumber}? This cannot be undone.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={() => remove.mutate(aircraftToDelete.id)} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete aircraft"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setAircraftToDelete(null)} disabled={remove.isPending}>Cancel</Button>
          </div>
        </div>
      )}
      {signedIn && (
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
          {editingId && (
            <Button type="button" variant="link" size="sm" onClick={cancelEdit}>Cancel</Button>
          )}
        </form>
      )}
    </CollapsibleSection>
  );
}

/** A signed-in pilot's own filed flights -- read-only here (filing one
 *  happens from the Flight Briefing page's own "Save this flight"). */
function FlightsPanel({ pilot }: { pilot: PilotState }) {
  const signedIn = pilot !== null && pilot !== "loading" && pilot !== "error";
  const [isOpen, setIsOpen] = useState(false);
  const {
    data: list, isLoading, error, refetch,
  } = useQuery({
    queryKey: ["flights"],
    queryFn: api.flights.list,
    enabled: signedIn && isOpen,
  });

  if (pilot === null || pilot === "error") {
    return (
      <CollapsibleSection title="My Flights">
        <p className="text-sm text-muted-foreground">
          {pilot === "error" ? "Your sign-in status could not be checked." : "Sign in to see flights you've filed."}
        </p>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title="My Flights" onOpenChange={setIsOpen}>
      {errorMessage(error, "Could not load your flights") && (
        <QueryError message={errorMessage(error, "Could not load your flights")!} onRetry={() => void refetch()} />
      )}
      {pilot === "loading" || isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? null : list?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No flights filed yet -- plan a route, open its Flight Briefing, and save it there.
        </p>
      ) : (
        <Table className="min-w-[32rem]">
          <TableCaption className="sr-only">Your filed flights</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="py-1 pr-4 pl-0">Route</TableHead>
              <TableHead className="py-1 pr-4">Aircraft</TableHead>
              <TableHead className="py-1 pr-4">Altitude</TableHead>
              <TableHead className="py-1 pr-4">Distance</TableHead>
              <TableHead className="py-1 pr-4">Filed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list?.map(f => (
              <TableRow key={f.id}>
                <TableCell className="py-1 pr-4 pl-0 font-mono">{f.departureIdent} → {f.destinationIdent}</TableCell>
                <TableCell className="py-1 pr-4">{f.aircraftTailNumber ?? "—"}</TableCell>
                <TableCell className="py-1 pr-4">{ft(f.cruiseAltitudeFt)}</TableCell>
                <TableCell className="py-1 pr-4">{f.totalDistanceNm == null ? "—" : `${f.totalDistanceNm.toFixed(1)} nm`}</TableCell>
                <TableCell className="py-1 pr-4">{new Date(f.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CollapsibleSection>
  );
}

/** The Account/Dev triggers -- identical in both of `SettingsView`'s
 *  own two return branches below, so it's pulled out once rather than
 *  copied into each `TwoRowHeader` call. */
const SETTINGS_TABS = (
  <>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="dev">Dev</TabsTrigger>
  </>
);

/** The Map icon standing in for Plan's own Settings gear on row one's
 *  own trailing edge -- an icon, not a label that used to read "Back
 *  to Map"/"Back to Brief"/"Back to Label" depending on which page's
 *  own gear sent a pilot here, but still that same exact destination
 *  (`href`, from `state.from`) rather than a flat, always-/plan link:
 *  leaving Settings should land back on the Map or Brief tab (or
 *  Label) a pilot actually came from, not always reset to Plan's own
 *  default view. */
function SettingsMapLink({ href }: { href: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" aria-label="Map">
          <Link to={href}>
            <MapIcon className="size-5" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Map</TooltipContent>
    </Tooltip>
  );
}

/**
 * Everything that isn't the map, in two tabs rather than one flat
 * stack a pilot's own aircraft used to sit in, between an algorithm
 * picker and a marketing blurb with nothing marking any of it apart
 * ("settings page UX best practices": grouping by category and naming
 * the groups is what makes a page like this scannable rather than a
 * flat list to hunt through -- see
 * https://baymard.com/blog/current-state-accounts-selfservice and
 * https://www.setproduct.com/blog/settings-ui-design). Account first
 * and selected by default -- a signed-in pilot's own data (aeroplanes,
 * filed flights), the actual reason a "Settings" page's own gear icon
 * exists, and standard UX research on settings pages agrees the
 * frequently-needed content belongs at the top, not buried under
 * developer demos. Dev second -- the actual `LabelView` workspace,
 * embedded inline the same way Plan's own Brief tab swaps in
 * `FlightBriefingView`, not a link out to a separate page: clicking
 * the tab shows real, live, interactive content immediately, the same
 * as clicking Plan's own Map tab does. `DevMlDrawer`'s own Model
 * Comparison/Algorithm Picker demos live inside this same tab, one tap
 * further behind a top drawer rather than a tab of their own --
 * they're read-only "how does this work" asides a pilot signed in to
 * actually rate checkpoints has no reason to have open by default the
 * way this tab's own labeling workspace does. Altitude Selection
 * Breakdown and Agent Framework Comparison used to live in that drawer
 * too; see `DevMlDrawer`'s own comment for where they went instead.
 * One page behind the header's own gear icon now, not three behind
 * separate nav items -- Plan is the only page anyone opens this app to
 * actually use; everything else here is either read-only context or an
 * occasional errand.
 *
 * Dev gets its OWN `<Shell>` (a second branch below, not one shared
 * with Account) rather than trying to swap its map/sidebar into a
 * single Shell instance's slots the way Plan swaps
 * FlightBriefingView/RouteMap into one -- LabelView owns real
 * map-and-sidebar state (`useLabelState`, a keyboard shortcut
 * listener) that must only run while its tab is actually active, not
 * for the lifetime of this whole page, which means it has to mount
 * and unmount with the tab rather than living in a component that
 * never unmounts the way `usePlanState` does for Map/Brief. Ratings in
 * progress do reset if you leave Dev and come back -- a real tradeoff,
 * accepted here because nothing behind it is a billed call or user
 * data the way Brief's own LangGraph/CrewAI narratives are (those stay
 * safe regardless, see PlanView's own comment).
 *
 * Which tab is active survives leaving this page and coming back
 * (`sessionStorage`, not just component state) -- the gear icon that
 * leads here doesn't know or pass along which tab a pilot had open
 * last time, so without this every fresh visit would silently reset
 * to Account even if Dev was what they actually came back to check on
 * again.
 */
const SETTINGS_TAB_KEY = "settings-tab";

export default function SettingsView() {
  useDocumentTitle("Settings — VFR Route");
  const {
    data: pilot, isLoading, isError: isPilotError, refetch: refetchPilot,
  } = useQuery({ queryKey: ["pilot"], queryFn: api.me });
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isPilotError ? "error" : null));
  const location = useLocation();
  // Where the gear that led here actually was -- the Map or Brief tab,
  // or Label (`SettingsButton`'s own `state.from`) -- so the Map icon
  // below leads back to that exact place instead of always resetting
  // to Plan's own default view. No state at all (Settings opened
  // directly, a bookmark or a fresh tab) falls back to the map.
  const mapHref = (location.state as { from?: string } | null)?.from ?? "/plan";
  const [tab, setTabState] = useState(() => {
    try { return sessionStorage.getItem(SETTINGS_TAB_KEY) ?? "account"; } catch { return "account"; }
  });
  const setTab = useCallback((next: string) => {
    setTabState(next);
    try { sessionStorage.setItem(SETTINGS_TAB_KEY, next); } catch { /* private browsing, storage disabled, etc. */ }
  }, []);
  // The Dev tab's own waypoint-list sidebar -- LabelView's own copy of
  // this same state (used by the standalone `/app/label` route) is a
  // separate instance, not this one; embedded mode never touches it.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (tab === "dev") {
    return (
      <LabelView embedded>
        {({ routeForm, guideButton, zoomButton, mapContent, sidebarContent }) => (
          <Shell
            header={
              <TwoRowHeader
                tab={tab} onTabChange={setTab} tabs={SETTINGS_TABS}
                rowOneStart={routeForm}
                rowOneEnd={<SettingsMapLink href={mapHref} />}
                trailing={(
                  <div className="flex items-center gap-2">
                    {guideButton}
                    {zoomButton}
                    <DevMlDrawer />
                    <SidebarToggleButton open={sidebarOpen} onClick={() => setSidebarOpen(o => !o)} label="Waypoints" />
                  </div>
                )}
              />
            }
            map={mapContent}
            sidebar={sidebarContent}
            sidebarOpen={sidebarOpen}
            onSidebarOpenChange={setSidebarOpen}
          />
        )}
      </LabelView>
    );
  }

  return (
    <Shell
      header={
        <TwoRowHeader
          tab={tab} onTabChange={setTab} tabs={SETTINGS_TABS}
          rowOneStart={<div />}
          rowOneEnd={<SettingsMapLink href={mapHref} />}
          trailing={<SignInStatus pilot={pilotState} onRetry={() => void refetchPilot()} />}
        />
      }
      sidebar={null}
      map={
        // A plain scrolling column, not Shell's usual map -- Shell's
        // own layout (header, then one flex-1 region below it) is
        // generic enough to hold this instead of a map without a
        // change; only the region's own content differs. Footer sits
        // outside the scrolling part on purpose -- inside it, its own
        // height would land wherever this tab's own content happened to
        // end rather than in the same place always.
        <div className="flex h-full flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <AircraftPanel pilot={pilotState} />
            <FlightsPanel pilot={pilotState} />
          </ScrollArea>
          <Footer />
        </div>
      }
    />
  );
}
