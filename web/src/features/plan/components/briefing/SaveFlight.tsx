import { useMemo } from "react";
import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, GraduationCap, Save } from "lucide-react";
import { toast } from "../../../../lib/toast";
import { DropdownMenuItem } from "../../../../components/ui/dropdown-menu";
import { ResponsivePopoverContent } from "../../../../components/ResponsivePopover";
import { ReviewAskForm, type ReviewAsk } from "../../../pilot/ReviewAsk";
import { localDay } from "../../../../lib/clock";
import { TEXT } from "../../../../lib/text";
import { api } from "../../../../lib/api/client";
import { pilotQuery, trainingQuery } from "../../../../lib/queryClient";
import type { Candidate, Course, Leg, NavLogAltitude, SaveFlightRequest, Totals } from "../../../../lib/api/types";
import { withoutAltitude } from "../../../../lib/identSchema";
import { navLogRows, savedCheckpoints } from "../navlog/rows";
import { FINDING_TONE } from "../../../../lib/status";
import { useRisk } from "../../../../lib/frat";
import { Spinner } from "../../../../components/ui/spinner";

/**
 * "Save this flight" -- files the nav log Spring Boot already has a
 * schema for (`flights`/`flight_checkpoints`) but, until this, no
 * caller ever populated. Not a print-page concern; this reads/writes
 * `/api/aircraft` and `/api/flights` directly (same Spring Boot
 * origin, same pattern the account panels use), independent
 * of planning-service entirely. Hidden while signed out rather than
 * shown disabled -- there is nothing a signed-out pilot could do
 * about it from here, and a disabled button with no explanation reads
 * as broken rather than as "sign in first."
 *
 * An item of the route's Share menu (PlanWorkspace puts it there, at the
 * pilot's ask, with Print and the rest: beside the chips only the
 * Approaches and Share), its state its glyph and its name: Save,
 * Saving…, Saved; said in a note once saved, the menu having gone. It
 * was a round button beside Share and Print, and before that a line of
 * its own at the head of the sections, with the airplane the flight would be filed
 * in spelled out beside it; that airplane is the header's own picker, a
 * line above.
 */
/** The flights saved, one mutation key for every Save item
 *  (SaveFlightButton) and the flight watch's save (FlightWatch). */
export const SAVE_FLIGHT = ["saveFlight"];

/** A plan as Save compares it: the same plan with its risk assessment
 *  made again is not another (SaveFlightButton). */
export const planOf = (r: SaveFlightRequest) => JSON.stringify({ ...r, risk: null });

/** The plan on screen as a flight to save: what Save files, and what a
 *  solo cross-country's review is asked of (ReviewAskSheet). */
export interface FlightToSave {
  course: Course | null;
  totals: Totals | null;
  nav: NavLogAltitude | null;
  legs: Leg[];
  selected: Candidate[];
  /** The airplane the nav log was computed for: a pilot's own, or
   *  null for a stock profile. */
  aircraftId: number | null;
  /** The departure time as an ISO instant, or "" -- what the saved
   *  flight is planned for. */
  depart: string;
  /** The altitudes the pilot set at points of the route, as the URL's
   *  `altitudes` writes them ("VPBNG:4500"), or "": filed with the
   *  flight, so opened again it is planned at them. */
  altitudes?: string;
  /** The address's other picks for the flight (lib/flightLink picksOf):
   *  filed too, so it opens again as it was planned. */
  picks?: string;
}

/** What would be filed, and only once there is a whole plan to file: the
 *  course (the airports' own idents and places, not a route being
 *  switched to), the nav log and its totals. Save used to be offered
 *  mid-stream, or after a stream failed, and filed null totals. */
export function useSaveRequest({ course, totals, nav, legs, selected, aircraftId, depart, altitudes = "", picks = "" }: FlightToSave): SaveFlightRequest | null {
  // The briefing's risk assessment (lib/frat), filed with the flight.
  const risk = useRisk(s => s.assessment);
  return useMemo((): SaveFlightRequest | null => {
    if (!course || !nav || !totals) return null;
    return {
      aircraftId,
      // A present position without the moment's altitude (withoutAltitude).
      departureIdent: withoutAltitude(course.departure.ident),
      destinationIdent: course.destination.ident,
      stops: (course.stops ?? []).map(stop => stop.ident),
      cruiseAltitudeFt: nav.altitude_ft,
      totalDistanceNm: totals.distance_nm,
      totalEteMin: totals.ete_min,
      totalFuelGal: totals.fuel_gal,
      plannedFor: depart || null,
      // The nav log's own rows (navLogRows), as the checkpoints Spring files.
      checkpoints: savedCheckpoints(navLogRows(course, selected, legs), course.distance_nm),
      risk: risk ? { score: risk.score, level: risk.level, factors: risk.factors.map(f => f.label) } : null,
      altitudes: altitudes || null,
      picks: picks || null,
    };
  }, [course, nav, totals, aircraftId, depart, selected, legs, risk, altitudes, picks]);
}

export function SaveFlightButton(flight: FlightToSave) {
  const queryClient = useQueryClient();
  // The one ["pilot"] query the console and the header share: signed out
  // after a Log out, back after a failed check is retried. A private
  // one-shot lookup here used to hide the section for the session after
  // one failed check, and keep offering Save after a Log out.
  const { data: pilot } = useQuery(pilotQuery);
  const request = useSaveRequest(flight);

  // Kept by the query client, not the item: the menu's content goes when
  // the menu closes, and with a mutation of the item's own the menu
  // opened again offered Save for a plan just saved -- a second click
  // filed it twice.
  const save = useMutation({
    mutationKey: SAVE_FLIGHT,
    mutationFn: api.flights.save,
    // The pilot console's list of flights, which it keeps; said in a
    // note, the menu it was saved from having gone.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
      toast.success("Flight Saved");
    },
  });
  // "Saved" belongs to the plan that was saved: another route, time,
  // airplane or altitude is a new request, and Save is offered again.
  // It used to stay "Saved" for the session, and a click filed a
  // duplicate of whatever was on screen by then. The same plan with its
  // risk assessment made again is not another: the briefing is asked for
  // again with the flight's time en route once the nav log has it, a
  // second or two after Save is offered, and "Saved" went back to Save.
  const plan = useMemo(() => request && planOf(request), [request]);
  const filedPlans = useMutationState({
    filters: { mutationKey: SAVE_FLIGHT, status: "success" },
    select: m => planOf(m.state.variables as SaveFlightRequest),
  });
  const saving = useIsMutating({ mutationKey: SAVE_FLIGHT }) > 0;
  const saved = !!plan && filedPlans.includes(plan);

  if (!pilot) return null;

  return (
    <DropdownMenuItem onSelect={() => request && save.mutate(request)} disabled={!request || saving || saved} data-testid="save-flight-button">
      {saving ? <Spinner aria-hidden /> : saved ? <Check /> : <Save />}
      {saving ? "Saving…" : saved ? "Saved" : "Save this flight"}
    </DropdownMenuItem>
  );
}

/**
 * "Ask for a solo cross-country review", an item of the route's Share
 * menu beside Save: for a student whose instructor has taken them on
 * (CheckridePage), once there is a whole plan to file. It opens the sheet
 * (ReviewAskSheet) the menu's own state keeps, the menu having gone.
 */
export function ReviewAskItem({ flight, onAsk }: { flight: FlightToSave; onAsk: () => void }) {
  const { data: pilot } = useQuery(pilotQuery);
  const { data: training } = useQuery({ ...trainingQuery, enabled: !!pilot });
  const request = useSaveRequest(flight);
  if (!pilot || !training?.instructors.some(l => l.accepted)) return null;
  return (
    <DropdownMenuItem disabled={!request} onSelect={onAsk} data-testid="ask-review">
      <GraduationCap />Ask for a solo cross-country review
    </DropdownMenuItem>
  );
}

/**
 * The review asked from the route itself: the plan on screen saved as a
 * flight -- with Save's own mutation, so Save says Saved after -- and put
 * to the instructor chosen, as a saved flight's page puts one
 * (ReviewAskForm), for 14 CFR 61.93(c)(3)'s review of its planning.
 */
export function ReviewAskSheet({ flight, onDone }: { flight: FlightToSave; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data: training } = useQuery(trainingQuery);
  const request = useSaveRequest(flight);
  const save = useMutation({ mutationKey: SAVE_FLIGHT, mutationFn: api.flights.save });
  // The flights saved this session, by their plan: one already saved is
  // asked about as it is, not filed again.
  const filed = useMutationState({
    filters: { mutationKey: SAVE_FLIGHT, status: "success" },
    select: m => ({ plan: planOf(m.state.variables as SaveFlightRequest), id: (m.state.data as { id: number }).id }),
  });
  const ask = useMutation({
    mutationFn: async (a: ReviewAsk) => {
      const plan = planOf(request!);
      const flightId = filed.find(f => f.plan === plan)?.id ?? (await save.mutateAsync(request!)).id;
      return api.training.askReview({ flightId, ...a });
    },
    onSuccess: next => {
      queryClient.setQueryData(["training"], next);
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
      toast.success("Sent to Your Instructor");
      onDone();
    },
  });
  const theirs = training?.instructors.filter(l => l.accepted) ?? [];
  return (
    <ResponsivePopoverContent
      title="Solo cross-country review" align="end" className="w-96 max-w-[calc(100vw-2rem)] p-3" data-testid="review-sheet"
      // Opened as the Share menu goes, whose focus goes back to its button
      // as it closes: taken for a move outside, it shut the sheet just
      // opened, now and then. A tap outside or Escape still closes it.
      onFocusOutside={e => e.preventDefault()}
      description="Your instructor reviews its planning and the weather, and endorses it for the airplane and the day (14 CFR 61.93(c)(3), (d))."
    >
      <div className="space-y-3">
        <ReviewAskForm
          instructors={theirs} pending={ask.isPending || !request} onAsk={a => ask.mutate(a)}
          initialDay={localDay(flight.depart ? new Date(flight.depart) : new Date())}
        />
        {ask.error && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)} data-testid="review-problem">{ask.error.message}</p>}
      </div>
    </ResponsivePopoverContent>
  );
}
