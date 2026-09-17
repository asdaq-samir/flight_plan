import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import CollapsibleSection from "../../components/CollapsibleSection";
import Footer from "../../components/Footer";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Field, FieldError } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { ApiError, api } from "../../lib/api/client";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import type { Aircraft, AircraftRequest, Pilot } from "../../lib/api/types";

const ft = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()} ft`);

type PilotState = Pilot | null | "loading";

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : err ? fallback : null;

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
 * Signed-in status, always visible (not a collapsible panel like the
 * rest of this page) -- it's identity, not content to skim past. A
 * 401 from `api.me()` is the ordinary signed-out case, not an error.
 * `pilot` is lifted to the parent rather than owned here, since the
 * Aircraft and Flights panels below also need to know whether anyone's
 * signed in; the ["pilot"] query itself is shared cache, not re-fetched
 * per panel.
 */
function SignInPanel({ pilot }: { pilot: PilotState }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pilot"] }),
  });

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm">
      {pilot === "loading" && <span className="text-muted-foreground">Checking sign-in…</span>}
      {pilot === null && (
        <Button asChild>
          <a href="/oauth2/authorization/google">Sign in with Google</a>
        </Button>
      )}
      {pilot && pilot !== "loading" && (
        <>
          <span>
            Signed in as <span className="font-semibold">{pilot.displayName}</span>
          </span>
          <Button onClick={() => logout.mutate()} disabled={logout.isPending}>Log out</Button>
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
    onSuccess: () => {
      cancelEdit();
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.aircraft.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aircraft"] }),
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
 * A signed-in pilot's own data -- aeroplanes and filed flights. Split
 * out from Playground (which stays sign-in-free, stateless demos)
 * because "manage my own data" is a different intent from "explore
 * how the project works," not because they don't both fit under one
 * roof technically.
 */
export default function AccountView() {
  useDocumentTitle("Account — VFR Route");
  const { data: pilot, isLoading } = useQuery({ queryKey: ["pilot"], queryFn: api.me });
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? null);

  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-background">
      <PageHeader />
      <SignInPanel pilot={pilotState} />
      <AircraftPanel pilot={pilotState} />
      <FlightsPanel pilot={pilotState} />
      <Footer />
    </div>
  );
}
