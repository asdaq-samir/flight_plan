import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../../components/ui/input-group";
import { Spinner } from "../../components/ui/spinner";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../components/ResponsivePopover";
import { useConfirm } from "../../components/useConfirm";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import { api } from "../../lib/api/client";
import type { Aircraft, AircraftRequest, FlightSummary, Pilot } from "../../lib/api/types";
import { CRUISE_REFERENCE_FT } from "../../lib/performance";
import { altFt, feet } from "../../lib/units";

/** Who is signed in, or why nobody is: null signed out, "loading"
 *  while the check is in flight, "error" when it failed. */
export type PilotState = Pilot | null | "loading" | "error";

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

/** A signed-in pilot's own aeroplanes -- list, add, edit (the same
 *  form, switched into "editing" mode by clicking a row), delete. The
 *  nav log's own aircraft picker offers these; this is where the list
 *  is kept. Nothing here means anything while signed out, so the panel
 *  says that plainly rather than showing an empty list that looks
 *  broken. */
export function AircraftPanel({ pilot }: { pilot: PilotState }) {
  const signedIn = pilot !== null && pilot !== "loading" && pilot !== "error";
  const queryClient = useQueryClient();
  const { data: list, isLoading } = useQuery({
    queryKey: ["aircraft"],
    queryFn: api.aircraft.list,
    enabled: signedIn,
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  // The form is behind a button beside the heading: open for a new
  // aeroplane from there, or for one of the rows from its Edit. Closed
  // again when the save lands, on Cancel, or from the same button.
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

  // Which aeroplane a save is for travels with it, the way `remove`'s id
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

  // Delete is in the aeroplane's own form, asked first: it was a red
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

  return (
    <section>
      <h3 className="text-sm font-semibold">Aircraft</h3>
      {pilot === null || pilot === "error" ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {pilot === "error" ? "Your sign-in status could not be checked." : "Sign in to keep your own aeroplanes; the nav log then flies them."}
        </p>
      ) : pilot === "loading" || isLoading ? (
        <p className="mt-1 text-sm text-muted-foreground">Fetching your aircraft…</p>
      ) : (
        // A grouped list at every width, as iOS lists things: a row per
        // aeroplane, tapped to edit it, and New aircraft as the last
        // row. It was a card per aeroplane with an Edit and a Delete on
        // each on a phone, a table from md up, and a small plus beside
        // the heading as the only way to add one.
        <ResponsivePopover open={formOpen} onOpenChange={open => (open ? setAdding(true) : cancelEdit())}>
          <ListGroup
            className="mt-2"
            footer={list?.length === 0 ? "Add your aeroplane, and the nav log flies its speed and fuel burn." : undefined}
          >
            {(list ?? []).map(a => (
              <div key={a.id} data-aircraft-row>
                <ListRow
                  title={<><span className="font-mono font-semibold">{a.tailNumber}</span> <span className="text-muted-foreground">{a.typeDesignator}</span></>}
                  description={`Cruise ${a.cruiseTasKt} kt, ${a.fuelBurnGph} gph${a.cruisePowerPct != null ? ` at ${a.cruisePowerPct}%` : ""}${
                    a.usableFuelGal != null ? ` · ${a.usableFuelGal} gal usable` : ""}`}
                  chevron
                  aria-label={`Edit ${a.tailNumber}`}
                  onClick={() => edit(a)}
                  // Not "outside" the open form: tapped with it open, the
                  // form switches to this aeroplane (see onInteractOutside).
                  data-aircraft-edit
                />
              </div>
            ))}
            <ResponsivePopoverTrigger asChild>
              <ListRow
                title={<span className="flex items-center gap-2 font-medium"><Plus className="size-4" />New aircraft</span>}
                data-testid="new-aircraft-button"
              />
            </ResponsivePopoverTrigger>
          </ListGroup>
          {/* On a phone a sheet from the header's edge, over the
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
            // switches the form to that aeroplane, where the stock
            // dismissal would have closed it on the press and reopened it
            // empty on the click.
            onInteractOutside={e => { if ((e.target as Element | null)?.closest?.("[data-aircraft-edit]")) e.preventDefault(); }}
          >
            <form id={formElementId} className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              {/* What the aeroplane is, then its speeds and fuel burns --
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
                  they are typed: they are the aeroplane's at this power at
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
 *  Flight Briefing page's own "Save this flight"; here a flight opens
 *  back on the planner (same route and altitude) or is deleted. */
export function FlightsPanel({ pilot }: { pilot: PilotState }) {
  const signedIn = pilot !== null && pilot !== "loading" && pilot !== "error";
  const queryClient = useQueryClient();
  const [flightToDelete, setFlightToDelete] = useState<FlightSummary | null>(null);
  const { data: list, isLoading, error } = useQuery({
    queryKey: ["flights"],
    queryFn: api.flights.list,
    enabled: signedIn,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.flights.remove(id),
    onSuccess: () => {
      toast.success("Flight deleted");
      setFlightToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
    },
  });


  /** Back to the planner on this flight's route, at its altitude. */
  const planHref = (f: FlightSummary) => `/plan?${new URLSearchParams({
    dep: f.departureIdent, dest: f.destinationIdent,
    ...(f.cruiseAltitudeFt != null ? { altitude_ft: String(f.cruiseAltitudeFt) } : {}),
  })}`;

  return (
    <section>
      <h3 className="text-sm font-semibold">My Flights</h3>
      {pilot === null || pilot === "error" ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {pilot === "error" ? "Your sign-in status could not be checked." : "Sign in to see flights you've filed."}
        </p>
      ) : pilot === "loading" || isLoading ? (
        <p className="mt-1 text-sm text-muted-foreground">Fetching your flights…</p>
      ) : error ? null : list?.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          No flights filed yet. Plan a route, open Flight Planning, and save it there.
        </p>
      ) : (
        <>
        <ul className="mt-2 divide-y rounded-md border md:hidden" aria-label="Your filed flights">
          {list?.map(f => (
            <li key={f.id} className="flex items-start justify-between gap-3 p-3 text-sm" data-flight-row>
              <div className="min-w-0">
                <div className="font-mono font-semibold">
                  {f.departureIdent} → {f.destinationIdent}
                  {f.aircraftTailNumber && <span className="ml-2 font-normal text-muted-foreground">{f.aircraftTailNumber}</span>}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {feet(f.cruiseAltitudeFt)}{f.totalDistanceNm != null && ` · ${f.totalDistanceNm.toFixed(1)} nm`} · filed {new Date(f.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <Button asChild variant="link" size="sm"><Link to={planHref(f)}>Open</Link></Button>
                <Button type="button" variant="link" size="sm" className="text-destructive" onClick={() => setFlightToDelete(f)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
        <Table containerClassName="mt-2 hidden rounded-md border md:block" className="min-w-[36rem]">
          <TableCaption className="sr-only">Your filed flights</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>Aircraft</TableHead>
              <TableHead className="text-right">Altitude</TableHead>
              <TableHead className="text-right">Distance</TableHead>
              <TableHead className="text-right">Filed</TableHead>
              <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list?.map(f => (
              <TableRow key={f.id}>
                <TableCell className="font-mono">{f.departureIdent} → {f.destinationIdent}</TableCell>
                <TableCell className="font-mono">{f.aircraftTailNumber ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{feet(f.cruiseAltitudeFt)}</TableCell>
                <TableCell className="text-right tabular-nums">{f.totalDistanceNm == null ? "—" : `${f.totalDistanceNm.toFixed(1)} nm`}</TableCell>
                <TableCell className="text-right tabular-nums">{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="link" size="sm"><Link to={planHref(f)}>Open</Link></Button>
                  <Button type="button" variant="link" size="sm" className="text-destructive" onClick={() => setFlightToDelete(f)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </>
      )}
      {flightToDelete && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
          <p>Delete the filed flight {flightToDelete.departureIdent} → {flightToDelete.destinationIdent}? This cannot be undone.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={() => remove.mutate(flightToDelete.id)} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete flight"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setFlightToDelete(null)} disabled={remove.isPending}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
