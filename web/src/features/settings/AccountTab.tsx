import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import CollapsibleSection from "../../components/CollapsibleSection";
import { Button } from "../../components/ui/button";
import { Field, FieldError } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import SignInModal from "./SignInModal";
import { api, describeError } from "../../lib/api/client";
import type { Aircraft, AircraftRequest } from "../../lib/api/types";
import { useErrorToasts } from "../../lib/usePageStatus";
import { errorMessage, type PilotState } from "./shared";

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
export function AircraftPanel({ pilot }: { pilot: PilotState }) {
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
    onError: err => toast.error(describeError(err, "Could not save the aircraft")),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.aircraft.remove(id),
    onSuccess: (_data, id) => {
      toast.success("Aircraft deleted");
      setAircraftToDelete(null);
      if (editingId === id) cancelEdit();
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
    onError: err => toast.error(describeError(err, "Could not delete the aircraft")),
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

  const listMessage = errorMessage(listError, "Could not load your aircraft");
  useErrorToasts({ aircraftList: listMessage && { message: listMessage, retry: () => void refetch() } });

  if (pilot === null || pilot === "error") {
    return (
      <CollapsibleSection title="Aircraft">
        <p className="text-sm text-muted-foreground">
          {pilot === "error" ? "Your sign-in status could not be checked." : "Sign in to manage your own aeroplanes."}
        </p>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title="Aircraft" onOpenChange={setIsOpen}>
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
export function FlightsPanel({ pilot }: { pilot: PilotState }) {
  const signedIn = pilot !== null && pilot !== "loading" && pilot !== "error";
  const [isOpen, setIsOpen] = useState(false);
  const {
    data: list, isLoading, error, refetch,
  } = useQuery({
    queryKey: ["flights"],
    queryFn: api.flights.list,
    enabled: signedIn && isOpen,
  });

  const listMessage = errorMessage(error, "Could not load your flights");
  useErrorToasts({ flightsList: listMessage && { message: listMessage, retry: () => void refetch() } });

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
