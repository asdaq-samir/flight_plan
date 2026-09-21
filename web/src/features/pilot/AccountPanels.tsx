import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Field, FieldError } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import SignInModal from "./SignInModal";
import { api } from "../../lib/api/client";
import type { Aircraft, AircraftRequest, FlightSummary, Pilot } from "../../lib/api/types";

/** Who is signed in, or why nobody is: null signed out, "loading"
 *  while the check is in flight, "error" when it failed. */
export type PilotState = Pilot | null | "loading" | "error";

const ft = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()} ft`);

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
  // Optional: blank means the owner has not said, and the nav log then
  // makes no fuel check rather than a wrong one.
  usableFuelGal: z.string().trim().refine(
    value => value === "" || (Number.isFinite(Number(value)) && Number(value) > 0),
    "Usable fuel must be a positive number",
  ),
});
type AircraftFormValues = z.infer<typeof aircraftSchema>;
const EMPTY_AIRCRAFT_FORM: AircraftFormValues = {
  tailNumber: "", typeDesignator: "", cruiseTasKt: "", fuelBurnGph: "", usableFuelGal: "",
};

/**
 * Signed-in status, at the top of the pilot console. `pilot` is
 * lifted to the parent rather than owned here, since the Aircraft and
 * Flights panels below also need to know whether anyone's signed in;
 * the ["pilot"] query itself is shared cache, not re-fetched per
 * panel. Signed out, this is just `SignInModal`'s own trigger button --
 * the three-provider prompt lives entirely in that component.
 */
export function SignInStatus({ pilot, onRetry }: { pilot: PilotState; onRetry: () => void }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.setQueryData(["pilot"], null);
      queryClient.removeQueries({ queryKey: ["aircraft"] });
      queryClient.removeQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
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
      usableFuelGal: a.usableFuelGal == null ? "" : String(a.usableFuelGal),
    });
  };

  const onSubmit = (values: AircraftFormValues) => save.mutate({
    tailNumber: values.tailNumber.trim(), typeDesignator: values.typeDesignator.trim(),
    cruiseTasKt: Number(values.cruiseTasKt), fuelBurnGph: Number(values.fuelBurnGph),
    usableFuelGal: values.usableFuelGal.trim() ? Number(values.usableFuelGal) : null,
  });


  return (
    <section>
      <h3 className="text-sm font-semibold">Aircraft</h3>
      {pilot === null || pilot === "error" ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {pilot === "error" ? "Your sign-in status could not be checked." : "Sign in to keep your own aeroplanes; the nav log then flies them."}
        </p>
      ) : pilot === "loading" || isLoading ? (
        <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {list && (
            // shadcn's own data-table framing (a bordered, rounded container
            // around stock cells) -- numbers right-aligned in tabular
            // figures so the units line up down a column.
            <Table containerClassName="mt-2 mb-3 rounded-md border" className="min-w-[34rem]">
              <TableCaption className="sr-only">Your saved aircraft</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Tail #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Cruise TAS</TableHead>
                  <TableHead className="text-right">Fuel burn</TableHead>
                  <TableHead className="text-right">Usable fuel</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="h-16 text-center text-muted-foreground">No aircraft yet.</TableCell></TableRow>
                )}
                {list.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono">{a.tailNumber}</TableCell>
                    <TableCell>{a.typeDesignator}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.cruiseTasKt} kt</TableCell>
                    <TableCell className="text-right tabular-nums">{a.fuelBurnGph} gph</TableCell>
                    <TableCell className="text-right tabular-nums">{a.usableFuelGal == null ? "—" : `${a.usableFuelGal} gal`}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="link" size="sm" onClick={() => edit(a)}>Edit</Button>
                      <Button type="button" variant="link" size="sm" className="text-destructive" onClick={() => setAircraftToDelete(a)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
            <Field data-invalid={!!errors.usableFuelGal} className="w-32">
              <Input
                {...register("usableFuelGal")} placeholder="Usable fuel (gal)"
                aria-label="Usable fuel in gallons" inputMode="decimal" aria-invalid={!!errors.usableFuelGal}
              />
              <FieldError errors={[errors.usableFuelGal]} />
            </Field>
            <Button type="submit" disabled={save.isPending}>{editingId ? "Save changes" : "Add aircraft"}</Button>
            {editingId && (
              <Button type="button" variant="link" size="sm" onClick={cancelEdit}>Cancel</Button>
            )}
          </form>
        </>
      )}
    </section>
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
        <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
      ) : error ? null : list?.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          No flights filed yet -- plan a route, open its Brief tab, and save it there.
        </p>
      ) : (
        <Table containerClassName="mt-2 rounded-md border" className="min-w-[36rem]">
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
                <TableCell className="text-right tabular-nums">{ft(f.cruiseAltitudeFt)}</TableCell>
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
