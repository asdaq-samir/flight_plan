import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Check, CircleMinus, Info, Plus, Route } from "lucide-react";
import EmptyState from "../../components/EmptyState";
import IconButton from "../../components/IconButton";
import { cn } from "cn";
import { routeName } from "../../lib/identSchema";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../../components/ui/input-group";
import { Spinner } from "../../components/ui/spinner";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../components/ResponsivePopover";
import { useConfirm } from "../../components/useConfirm";
import { ConsolePages, PageRow } from "../../components/ConsolePages";
import FlightPage from "./FlightPage";
import { aircraftKey, choiceOf } from "../../lib/aircraftChoice";
import { api } from "../../lib/api/client";
import type { Aircraft, AircraftRequest, FlightSummary } from "../../lib/api/types";
import { CRUISE_REFERENCE_FT } from "../../lib/performance";
import { usePreferences } from "../../lib/preferences";
import { TEXT } from "../../lib/text";
import { altFt, feet } from "../../lib/units";
import { LEVEL_TONE, riskLine, type RiskLevel } from "../../lib/frat";

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
/** Blank, or a positive number: a figure the owner may leave unsaid. */
const optionalPositiveNumber = (label: string) => z.string().trim().refine(
  value => value === "" || (Number.isFinite(Number(value)) && Number(value) > 0),
  `${label} must be a positive number`,
);
/** Blank, or a power a cruise table has: 40 to 100 percent, the
 *  server's limits and the planner's. */
const optionalPercent = (label: string) => z.string().trim().refine(
  value => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 40 && Number(value) <= 100),
  `${label} must be between 40 and 100%`,
);
/** A form field as the request carries it: blank is null. */
const orNull = (value: string) => (value.trim() ? Number(value) : null);

const aircraftSchema = z.object({
  // The server's limits, which are the columns': longer was refused there
  // as though it were a tail number already on file.
  tailNumber: z.string().trim().min(1, "Tail number is required").max(16, "At most 16 characters"),
  typeDesignator: z.string().trim().min(1, "Type designator is required").max(16, "At most 16 characters"),
  cruiseTasKt: positiveNumber("Cruise speed"),
  fuelBurnGph: positiveNumber("Cruise fuel burn"),
  // Optional: blank flies the cruise figures at the type's own power.
  cruisePowerPct: optionalPercent("Cruise power"),
  // Optional: blank climbs at the planner's book figures for the type.
  climbTasKt: optionalPositiveNumber("Climb speed"),
  climbFuelBurnGph: optionalPositiveNumber("Climb fuel burn"),
  // Optional: blank means the owner has not said, and the nav log then
  // makes no fuel check rather than a wrong one.
  usableFuelGal: optionalPositiveNumber("Usable fuel"),
});
type AircraftFormValues = z.infer<typeof aircraftSchema>;
const EMPTY_AIRCRAFT_FORM: AircraftFormValues = {
  tailNumber: "", typeDesignator: "", cruiseTasKt: "", fuelBurnGph: "", cruisePowerPct: "", climbTasKt: "",
  climbFuelBurnGph: "", usableFuelGal: "",
};

/** A signed-in pilot's own airplanes -- the one the nav log flies
 *  ticked, and a tap on another flies that one, as iOS lists Wi-Fi
 *  networks; the ⓘ at a row's end opens its figures to edit (the same
 *  form as a new one's), and delete. The picker under the route offers
 *  the same choice. The Library's (PilotPanel), shown only to someone
 *  signed in: it says once, for all three, what signing in keeps. */
export function AircraftPanel() {
  const queryClient = useQueryClient();
  const { data: list, isLoading } = useQuery({ queryKey: ["aircraft"], queryFn: api.aircraft.list });
  // Which the nav log flies, remembered per browser, and the stock
  // profiles a pilot's own rides on (PlanWorkspace asks the same).
  const flying = usePreferences(s => s.aircraft);
  const fly = usePreferences(s => s.setAircraft);
  const { data: profiles } = useQuery({ queryKey: ["aircraftProfiles"], queryFn: api.aircraftProfiles, staleTime: Infinity });
  const [editingId, setEditingId] = useState<number | null>(null);
  // The form is behind the list's New aircraft row: open for a new
  // airplane from there, or for one of the rows from its ⓘ. Closed
  // again when the save lands, on Cancel, or from the same row.
  const [adding, setAdding] = useState(false);
  const formOpen = adding || editingId !== null;
  const formId = useId();
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<AircraftFormValues>({
    resolver: zodResolver(aircraftSchema),
    defaultValues: EMPTY_AIRCRAFT_FORM,
  });

  const cancelEdit = () => {
    setEditingId(null);
    setAdding(false);
    reset(EMPTY_AIRCRAFT_FORM);
  };

  // Which airplane a save is for travels with it, the way `remove`'s id
  // does: it used to be read from the form's state when the save
  // finished, so an add still in flight when Edit was clicked on another
  // row toasted "updated" and wiped the form just opened.
  const save = useMutation({
    mutationFn: ({ id, request }: { id: number | null; request: AircraftRequest }) =>
      id ? api.aircraft.update(id, request) : api.aircraft.add(request),
    // The only other feedback a save gets is a row quietly changing in
    // a table below the form -- easy to miss with your eyes still on
    // the inputs you just submitted, unlike Plan/Label's own toasts
    // (usePageStatus), which confirm something already big and visible
    // (a route, a rating). This is the one place in the app a genuine
    // list-editing success has nothing else to announce it.
    onSuccess: (_data, { id }) => {
      toast.success(id ? "Aircraft updated" : "Aircraft added");
      // Cleared only while it still shows what was saved.
      if (editingId === id) cancelEdit();
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.aircraft.remove(id),
    onSuccess: (_data, id) => {
      toast.success("Aircraft deleted");
      if (editingId === id) cancelEdit();
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
  });

  const edit = (a: Aircraft) => {
    setEditingId(a.id);
    reset({
      tailNumber: a.tailNumber, typeDesignator: a.typeDesignator,
      cruiseTasKt: String(a.cruiseTasKt), fuelBurnGph: String(a.fuelBurnGph),
      cruisePowerPct: a.cruisePowerPct == null ? "" : String(a.cruisePowerPct),
      climbTasKt: a.climbTasKt == null ? "" : String(a.climbTasKt),
      climbFuelBurnGph: a.climbFuelBurnGph == null ? "" : String(a.climbFuelBurnGph),
      usableFuelGal: a.usableFuelGal == null ? "" : String(a.usableFuelGal),
    });
  };

  const onSubmit = (values: AircraftFormValues) => save.mutate({ id: editingId, request: {
    tailNumber: values.tailNumber.trim(), typeDesignator: values.typeDesignator.trim(),
    cruiseTasKt: Number(values.cruiseTasKt), fuelBurnGph: Number(values.fuelBurnGph),
    cruisePowerPct: orNull(values.cruisePowerPct),
    climbTasKt: orNull(values.climbTasKt), climbFuelBurnGph: orNull(values.climbFuelBurnGph),
    usableFuelGal: orNull(values.usableFuelGal),
  } });

  // Delete is in the airplane's own form, asked first: it was a red
  // word on every row, beside Edit.
  const editing = list?.find(a => a.id === editingId) ?? null;
  const [askDelete, deleteDialog] = useConfirm({
    title: `Delete ${editing?.tailNumber ?? "this aircraft"}?`,
    description: "It goes from your aircraft and from the nav log's picker. This can't be undone.",
    confirmLabel: "Delete aircraft",
    destructive: true,
    onConfirm: () => { if (editingId !== null) remove.mutate(editingId); },
  });
  const formElementId = `${formId}-form`;
  const problem = (message?: string) => (message ? <span className="text-destructive">{message}</span> : undefined);

  // The tab says what this is: no heading over the list, only the
  // group's own, as an iOS page under a segmented control has.
  return (
    <section aria-label="Aircraft">
      {isLoading ? (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching your aircraft…</p>
      ) : (
        // A grouped list at every width, as iOS lists things: a row per
        // airplane, and New aircraft as the last row. It was a card per
        // airplane with an Edit and a Delete on each on a phone, a table
        // from md up, and a small plus beside the heading as the only way
        // to add one; then a row that opened the form, and which one the
        // nav log flew was said only under the route.
        <ResponsivePopover open={formOpen} onOpenChange={open => (open ? setAdding(true) : cancelEdit())}>
          <ListGroup
            title="Your aircraft"
            footer={list?.length === 0
              ? "Add your airplane, and the nav log flies its speed and fuel burn."
              : flying.aircraftId != null
                ? "The nav log flies the one ticked. Tap another to fly it, or ⓘ for its figures."
                : `The nav log flies the stock ${flying.label} now. Tap one of yours to fly it.`}
          >
            {(list ?? []).map(a => {
              const chosen = aircraftKey(flying) === `mine:${a.id}`;
              return (
                <div key={a.id} className="flex items-center" data-aircraft-row>
                  {/* The tick before the name, its place kept when it is
                      elsewhere so the names line up, as Wi-Fi's are. */}
                  <ListRow
                    className="min-w-0 flex-1"
                    media={<Check className={cn("size-5 text-tint", !chosen && "invisible")} aria-hidden />}
                    title={<><span className="font-mono font-semibold">{a.tailNumber}</span> <span className="text-muted-foreground">{a.typeDesignator}</span></>}
                    description={`Cruise ${a.cruiseTasKt} kt, ${a.fuelBurnGph} gph${a.cruisePowerPct != null ? ` at ${a.cruisePowerPct}%` : ""}${
                      a.usableFuelGal != null ? ` · ${a.usableFuelGal} gal usable` : ""}`}
                    aria-pressed={chosen}
                    onClick={() => { if (!chosen) fly(choiceOf(a, profiles ?? [])); }}
                  />
                  <IconButton
                    label={`Edit ${a.tailNumber}`} onClick={() => edit(a)} className="mr-1.5 shrink-0 text-tint"
                    // Not "outside" the open form: tapped with it open, the
                    // form switches to this airplane (see onInteractOutside).
                    data-aircraft-edit
                  >
                    <Info className="size-5" />
                  </IconButton>
                </div>
              );
            })}
            <ResponsivePopoverTrigger asChild>
              <ListRow
                title={<span className="flex items-center gap-2 font-medium"><Plus className="size-4" />New aircraft</span>}
                data-testid="new-aircraft-button"
              />
            </ResponsivePopoverTrigger>
          </ListGroup>
          {/* On a phone a sheet from the navigation bar's edge, over the
              console's own; from md up a popover by the rows. Cancel and
              Add (or Save) in its title row, as an iOS form sheet has
              them; each field a row, its label at the start and the
              field at the end, units inside. */}
          <ResponsivePopoverContent
            title={editingId ? "Edit aircraft" : "New aircraft"}
            align="start" className="w-80"
            leading={<Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={cancelEdit}>Cancel</Button>}
            action={(
              // A spinner while it saves: disabled alone looked like
              // nothing was happening. The name stays the words.
              <Button
                type="submit" form={formElementId} size="sm" className="-mr-1"
                disabled={save.isPending} aria-busy={save.isPending}
                aria-label={editingId ? "Save changes" : "Add aircraft"}
              >
                {save.isPending && <Spinner role="presentation" aria-label={undefined} aria-hidden />}
                {editingId ? "Save" : "Add"}
              </Button>
            )}
            // A row, tapped while the form is open, is not "outside": it
            // switches the form to that airplane, where the stock
            // dismissal would have closed it on the press and reopened it
            // empty on the click.
            onInteractOutside={e => { if ((e.target as Element | null)?.closest?.("[data-aircraft-edit]")) e.preventDefault(); }}
          >
            <form id={formElementId} className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              {/* What the airplane is, then its speeds and fuel burns --
                  climb and cruise, a row each under the group's heading
                  -- and the power the cruise is at, then its tanks. Each
                  field keeps its label and unit while it is typed in; the
                  placeholders are examples. The accessible names say the
                  phase and the units in full. The identifiers are
                  capitals and never autocorrected. */}
              <ListGroup>
                <ListRow id={`${formId}-tail`} title="Tail number" description={problem(errors.tailNumber?.message)}>
                  <Input
                    id={`${formId}-tail`} {...register("tailNumber")} placeholder="N12345" className="h-8 w-32 text-right"
                    aria-label="Tail number" aria-invalid={!!errors.tailNumber}
                    autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  />
                </ListRow>
                <ListRow id={`${formId}-type`} title="Type" description={problem(errors.typeDesignator?.message)}>
                  <Input
                    id={`${formId}-type`} {...register("typeDesignator")} placeholder="C172" className="h-8 w-32 text-right"
                    aria-label="Type designator" aria-invalid={!!errors.typeDesignator}
                    autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  />
                </ListRow>
              </ListGroup>
              <ListGroup title="True airspeed">
                <NumberRow
                  id={`${formId}-climb-tas`} title="Climb" unit="kt" placeholder="74" name="Climb TAS in knots"
                  field={register("climbTasKt")} error={errors.climbTasKt?.message}
                />
                <NumberRow
                  id={`${formId}-tas`} title="Cruise" unit="kt" placeholder="110" name="Cruise TAS in knots"
                  field={register("cruiseTasKt")} error={errors.cruiseTasKt?.message}
                />
              </ListGroup>
              <ListGroup title="Fuel burn" footer="Climb is optional: left blank, the nav log climbs at the type's book figures.">
                <NumberRow
                  id={`${formId}-climb-burn`} title="Climb" unit="gph" placeholder="11" name="Climb fuel burn in gallons per hour"
                  field={register("climbFuelBurnGph")} error={errors.climbFuelBurnGph?.message}
                />
                <NumberRow
                  id={`${formId}-burn`} title="Cruise" unit="gph" placeholder="8.5" name="Cruise fuel burn in gallons per hour"
                  field={register("fuelBurnGph")} error={errors.fuelBurnGph?.message}
                />
              </ListGroup>
              {/* What the cruise figures mean to the planner, said where
                  they are typed: they are the airplane's at this power at
                  the reference altitude, and each leg flies them in its own
                  air (vfr.performance). */}
              <ListGroup
                footer={`The cruise speed and burn at this power at ${altFt(CRUISE_REFERENCE_FT)} ft on a standard day, as a handbook's cruise table gives them. Each leg flies them in the forecast air at its altitude. Left blank, the type's.`}
              >
                <NumberRow
                  id={`${formId}-power`} title="Cruise power" unit="%" placeholder="65" name="Cruise power in percent"
                  field={register("cruisePowerPct")} error={errors.cruisePowerPct?.message}
                />
              </ListGroup>
              <ListGroup footer="Usable fuel is optional; without it the nav log makes no fuel check.">
                <NumberRow
                  id={`${formId}-usable`} title="Usable fuel" unit="gal" placeholder="40" name="Usable fuel in gallons"
                  field={register("usableFuelGal")} error={errors.usableFuelGal?.message}
                />
              </ListGroup>
              {editingId !== null && (
                <ListGroup>
                  <ListRow
                    title={<span className="font-medium text-destructive">Delete aircraft</span>}
                    onClick={askDelete} disabled={remove.isPending} data-testid="delete-aircraft-button"
                  />
                </ListGroup>
              )}
            </form>
          </ResponsivePopoverContent>
          {deleteDialog}
        </ResponsivePopover>
      )}
    </section>
  );
}

/** One of the aircraft form's figures: its label at the start, the
 *  number at the end with its unit inside the field, and what is wrong
 *  with it under the label. `name` is the accessible name, the phase
 *  and the unit in full ("Climb TAS in knots"). */
function NumberRow({ id, title, unit, placeholder, name, field, error }: {
  id: string;
  title: string;
  unit: string;
  placeholder: string;
  name: string;
  field: UseFormRegisterReturn;
  error?: string;
}) {
  return (
    <ListRow id={id} title={title} description={error ? <span className="text-destructive">{error}</span> : undefined}>
      <InputGroup className="h-8 w-32">
        <InputGroupInput
          id={id} {...field} placeholder={placeholder} className="text-right"
          aria-label={name} inputMode="decimal" aria-invalid={!!error}
        />
        <InputGroupAddon align="inline-end"><InputGroupText>{unit}</InputGroupText></InputGroupAddon>
      </InputGroup>
    </ListRow>
  );
}

/** A signed-in pilot's own filed flights. Filing one happens from the
 *  planning panel's own Save, beside the route; here a flight opens
 *  back on the planner (same route and altitude) or is deleted. A
 *  grouped list at every width, as iOS lists things: a tap on a row
 *  opens the flight and puts the console away, and Edit over the list
 *  puts a red minus before each row, which deletes it once asked in
 *  the app's own sheet. It was an Open and a Delete at every row's
 *  end, and before that a card a flight on a phone and a six-column
 *  table from md up. */
export function FlightsPanel() {
  const queryClient = useQueryClient();
  const [flightToDelete, setFlightToDelete] = useState<FlightSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const { data: list, isLoading, error } = useQuery({ queryKey: ["flights"], queryFn: api.flights.list });

  const remove = useMutation({
    mutationFn: (id: number) => api.flights.remove(id),
    onSuccess: () => {
      toast.success("Flight deleted");
      setFlightToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
    },
  });
  const [askDelete, deleteDialog] = useConfirm({
    title: flightToDelete ? `Delete ${routeName(flightToDelete.departureIdent, flightToDelete.destinationIdent, flightToDelete.stops)}?` : "Delete this flight?",
    description: "The filed flight goes from your flights. This can't be undone.",
    confirmLabel: "Delete flight",
    destructive: true,
    onConfirm: () => { if (flightToDelete) remove.mutate(flightToDelete.id); },
  });

  /** Back to the planner on this flight's route, through its stops, at
   *  its altitude and the ones the pilot set at its points. */
  const planHref = (f: FlightSummary) => `/plan?${new URLSearchParams({
    dep: f.departureIdent, dest: f.destinationIdent,
    ...(f.stops.length ? { stops: f.stops.join(",") } : {}),
    ...(f.cruiseAltitudeFt != null ? { altitude_ft: String(f.cruiseAltitudeFt) } : {}),
    ...(f.altitudes ? { altitudes: f.altitudes } : {}),
  })}`;

  // A page a flight (FlightPage), opened from its row.
  const pages = Object.fromEntries((list ?? []).map(f => [`flight-${f.id}`, {
    title: routeName(f.departureIdent, f.destinationIdent, f.stops),
    content: <FlightPage summary={f} planHref={planHref(f)} />,
  }]));

  return (
    <ConsolePages back="Flights" pages={pages}>
      <section aria-label="Flights">
        {isLoading ? (
          <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching your flights…</p>
        ) : error ? null : list?.length === 0 ? (
          <EmptyState icon={<Route />} title="No Flights">
            Plan a route, then Save beside it, and the flight is kept here.
          </EmptyState>
        ) : (
          <ListGroup
            title="Saved flights"
            action={(
              <Button
                type="button" variant="ghost" size="sm"
                className={cn("-mr-1 h-auto px-1 py-0.5 font-normal text-tint", TEXT.row, editing && "font-semibold")}
                onClick={() => setEditing(e => !e)} data-testid="flights-edit"
              >
                {editing ? "Done" : "Edit"}
              </Button>
            )}
            footer={editing ? "Delete a flight with the minus before it." : "A flight opens with its nav log, on the map at its altitude, and its debrief from your track."}
          >
            {(list ?? []).map(f => {
              const name = routeName(f.departureIdent, f.destinationIdent, f.stops);
              const row = {
                title: <>
                  <span className="font-mono font-semibold">{name}</span>
                  {f.aircraftTailNumber && <span className="text-muted-foreground"> {f.aircraftTailNumber}</span>}
                </>,
                description: <span className="tabular-nums">
                  {feet(f.cruiseAltitudeFt)}{f.totalDistanceNm != null && ` · ${f.totalDistanceNm.toFixed(1)} nm`} · filed {new Date(f.createdAt).toLocaleDateString()}
                  {/* The risk assessment it was saved with (lib/frat). */}
                  {f.risk && <span className={cn("block", LEVEL_TONE[f.risk.level as RiskLevel])} data-testid="flight-risk">Risk {riskLine(f.risk).toLowerCase()}</span>}
                </span>,
              };
              return editing ? (
                <ListRow
                  key={f.id} {...row}
                  media={(
                    <IconButton
                      label={`Delete ${name}`} className="-ml-1.5 text-destructive"
                      onClick={() => { setFlightToDelete(f); askDelete(); }} disabled={remove.isPending}
                    >
                      <CircleMinus className="size-5 fill-destructive text-white dark:text-background" />
                    </IconButton>
                  )}
                />
              ) : (
                // Its own page: what was filed, the way back onto the map,
                // and its debrief.
                <PageRow key={f.id} page={`flight-${f.id}`} {...row} />
              );
            })}
          </ListGroup>
        )}
        {deleteDialog}
      </section>
    </ConsolePages>
  );
}
