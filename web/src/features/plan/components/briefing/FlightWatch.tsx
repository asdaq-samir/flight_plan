import { useMemo, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Switch } from "../../../../components/ui/switch";
import { api, describeError } from "../../../../lib/api/client";
import type { SaveFlightRequest } from "../../../../lib/api/types";
import { flightWatch, type FlightWatch as Watch } from "../../../../lib/api/words";
import { useBriefPlan } from "../../../../lib/briefPlan";
import { clockTime, useMinuteClock } from "../../../../lib/clock";
import { pilotQuery } from "../../../../lib/queryClient";
import { TEXT } from "../../../../lib/text";
import SourceChips from "../ask/SourceChips";
import DepartPicker from "../navlog/DepartPicker";
import { planOf, SAVE_FLIGHT, useSaveRequest, type FlightToSave } from "./SaveFlight";

/** How often the watch is read while the Brief is open: the gateway
 *  checks on its own clock, and the Brief shows what it found. */
const POLL_MS = 5 * 60_000;
/** With no departure set, the watch is for a flight two hours out. */
const DEFAULT_AHEAD_MS = 2 * 60 * 60_000;

const NOTHING: FlightToSave = { course: null, totals: null, nav: null, legs: [], selected: [], aircraftId: null, depart: "" };

/** The flight's watch, read every five minutes while the Brief is open;
 *  null where there is none. */
const watchQuery = (flightId: number | null) => ({
  queryKey: ["flight-watch", flightId] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => flightWatch.get(flightId!, signal),
  enabled: flightId !== null, staleTime: POLL_MS, refetchInterval: POLL_MS, meta: { silent: true },
});

/**
 * "Watch this flight": a switch (iOS's own 51 by 31 to a finger) with the
 * departure it is watched for beside it -- the plan's own time, or two
 * hours from now -- and under it what changed since, in words with the
 * reports that changed (SourceChips). The watch is on the saved flight,
 * so switching it on saves the plan first where it is not yet, through
 * Save's own mutation, and Save in the route's ••• menu then says Saved;
 * a plan saved earlier is found in the pilot's flights by its route and
 * time. Only for a signed-in pilot, as Save is.
 */
export default function FlightWatch() {
  const queryClient = useQueryClient();
  const { data: pilot } = useQuery(pilotQuery);
  const plan = useBriefPlan();
  const request = useSaveRequest(plan.flight ?? NOTHING);
  const planKey = useMemo(() => request && planOf(request), [request]);
  // When it leaves: the plan's departure, else two hours from when the
  // Brief opened (read once: the clock is not read in a render), until
  // the pilot picks one here.
  const [picked, setPicked] = useState<string | null>(null);
  const [twoHoursOut] = useState(() => new Date(Date.now() + DEFAULT_AHEAD_MS).toISOString());
  const departAt = picked ?? (plan.depart || twoHoursOut);
  // The minute, for the earliest the picker allows: not before now.
  const minute = useMinuteClock();
  // The flight saved this session for this plan (Save's own mutations),
  // or earlier, in the pilot's flights.
  const filed = useMutationState({
    filters: { mutationKey: SAVE_FLIGHT, status: "success" },
    select: m => ({ plan: planOf(m.state.variables as SaveFlightRequest), id: (m.state.data as { id: number }).id }),
  });
  const { data: flights } = useQuery({ queryKey: ["flights"], queryFn: api.flights.list, enabled: !!pilot, staleTime: 60_000, meta: { silent: true } });
  const sameStops = (a: string[], b: (string | null)[] | null | undefined) => {
    const stops = (b ?? []).filter((s): s is string => s !== null);
    return a.length === stops.length && a.every((s, i) => s === stops[i]);
  };
  const flightId: number | null = (planKey ? filed.find(f => f.plan === planKey)?.id : undefined)
    ?? (request ? flights?.find(f =>
      f.departureIdent === request.departureIdent && f.destinationIdent === request.destinationIdent
      && sameStops(f.stops, request.stops) && (f.plannedFor ?? null) === (request.plannedFor ?? null))?.id : undefined)
    ?? null;
  const watch = useQuery(watchQuery(flightId));
  const save = useMutation({ mutationKey: SAVE_FLIGHT, mutationFn: api.flights.save, meta: { silent: true } });
  const start = useMutation({
    mutationFn: async (at: string) => {
      const id = flightId ?? (await save.mutateAsync(request!)).id;
      if (flightId === null) void queryClient.invalidateQueries({ queryKey: ["flights"] });
      return flightWatch.start(id, at);
    },
    onSuccess: (w: Watch) => queryClient.setQueryData(watchQuery(w.flightId).queryKey, w),
    meta: { silent: true },
  });
  const stop = useMutation({
    mutationFn: () => flightWatch.stop(flightId!),
    onSuccess: () => queryClient.setQueryData(watchQuery(flightId).queryKey, null),
    meta: { silent: true },
  });
  if (!pilot || !plan.routed) return null;
  const on = !!watch.data;
  const busy = start.isPending || stop.isPending;
  const problem = start.error ?? stop.error;
  const setDepart = (iso: string) => {
    setPicked(iso || null);
    // Moved while watched: the watch moved with it.
    if (on && iso) start.mutate(iso);
  };
  return (
    <section className="flex flex-col gap-2" data-testid="flight-watch" aria-label="Flight watch">
      {/* The picker's 44-point area reaches 10 past it and the switch's 12
          (their ::after insets): gap-6 keeps the two apart. */}
      <div className="flex items-center gap-6 rounded-xl bg-card px-3.5 py-2.5 shadow-[0_0_0_0.5px_var(--border)]">
        <label htmlFor="flight-watch-switch" className={cn("min-w-0 flex-1 font-medium", TEXT.row)}>Watch this flight</label>
        <DepartPicker value={departAt} onChange={setDepart} look="time" label="Watched departure" testId="flight-watch-depart" leavesNow={false} earliest={minute} />
        <Switch
          id="flight-watch-switch" checked={on} disabled={!request || busy} data-testid="flight-watch-switch"
          onCheckedChange={next => (next ? start.mutate(departAt) : stop.mutate())}
        />
      </div>
      {problem && <p className={cn("px-1 text-destructive-ink", TEXT.note)} role="alert" data-testid="flight-watch-problem">{describeError(problem, "The watch could not be set")}</p>}
      {watch.data && (
        watch.data.changes.length > 0 ? (
          <div className="px-1" data-testid="flight-watch-changes">
            <p className={cn("tabular-nums", TEXT.prose)}>
              <span className="font-semibold">What changed: </span>
              {watch.data.changes.map((c, i) => <span key={i}>{i > 0 ? " " : ""}{c.text}</span>)}
            </p>
            <SourceChips sources={watch.data.sources} testId="flight-watch-source" />
          </div>
        ) : (
          <p className={cn("px-1 text-muted-foreground tabular-nums", TEXT.note)} data-testid="flight-watch-quiet">
            Checked {clockTime(new Date(watch.data.checkedAt))}, nothing has changed
          </p>
        )
      )}
    </section>
  );
}
