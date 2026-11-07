import { useCallback, useMemo } from "react";
import { experimental_streamedQuery as streamedQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { showError } from "../../../lib/problems";
import { api, describeError } from "../../../lib/api/client";
import { ended } from "../../../lib/api/streams";
import { subscriptionQuery } from "../../../lib/subscription";
import type { Leg, NarrativeMessage, NarrativeRequest, NavLogAltitude } from "../../../lib/api/types";

/** The narrative as it streams: the text so far (or the whole briefing
 *  once done), why there is none, and whether it is still being
 *  written. */
export interface Narrative {
  text: string | null;
  error: string | null;
  loading: boolean;
}

interface NarrativeInput {
  dep: string;
  dest: string;
  /** The nav log's own key (usePlan's), so a narrative is always about
   *  the log on screen. */
  planKey: readonly unknown[];
  nav: NavLogAltitude | null;
  legs: Leg[];
  /** Whether every leg is in: the request carries them all. */
  whole: boolean;
}

/**
 * The narrative about the nav log on screen -- asked for by the pilot's
 * own tap, a real, billed Claude call (the planner's
 * /api/briefing/narrative). Only about a log that is flown: with no
 * winds there are no legs.
 *
 * Its own hook, beside usePlan rather than inside it: what is sent and
 * how the stream is read change for the narrative's reasons, not the
 * nav log's.
 */
export function useNarrative({ dep, dest, planKey, nav, legs, whole }: NarrativeInput) {
  const request: NarrativeRequest | null = nav && nav.altitude_ft !== null && nav.flown !== null ? {
    departure_ident: dep, destination_ident: dest, aircraft_name: nav.aircraft.name,
    altitude_ft: nav.altitude_ft, altitude_selection: nav.altitude_selection, flown: nav.flown, legs,
  } : null;
  // The nav log's own key, not a few fields of it: this one left out the
  // departure time, the choice of plan, Load and the airplane's own
  // numbers, and held the leg count, which changes while legs stream --
  // so a narrative could be shown, or printed, beside a different log.
  const query = useQuery({
    queryKey: ["narrative", ...planKey],
    queryFn: streamedQuery({
      streamFn: ({ signal }: { signal: AbortSignal }) => ended(api.narrative(request!, signal), "narrative"),
    }),
    enabled: false, staleTime: Infinity,
    // Said in its own tab, where it was asked for (BriefNarrative).
    meta: { silent: true },
  });
  // The query's own refetch, which keeps its identity, not the query
  // result, which is new at every render: so is this, and with it the
  // Brief, drawn again at every render of the page.
  // Each narrative is one of the month's (the subscription's cap): its
  // count, asked again once one is written.
  const queryClient = useQueryClient();
  const { refetch } = query;
  const generateNarrative = useCallback(() => {
    // Only a whole log: the request carries its legs, and a narrative of
    // half of them would be kept for this key as if it were the whole.
    if (!whole) { showError("The nav log isn't fully loaded yet", "The narrative is written from the whole nav log: ask again once every leg is in."); return; }
    void refetch().then(() => queryClient.invalidateQueries({ queryKey: subscriptionQuery.queryKey }));
  }, [whole, refetch, queryClient]);
  // The same object while its stream is, for the same reason.
  const narrative = useMemo(
    () => narrativeOf(query.data, query.error, query.isFetching), [query.data, query.error, query.isFetching]);

  return { narrative, generateNarrative };
}

function narrativeOf(data: NarrativeMessage[] | undefined, error: Error | null, loading: boolean): Narrative {
  const chunks = data ?? [];
  const done = chunks.find(m => m.type === "done");
  const text = done && done.type === "done" ? done.briefing : chunks.map(m => (m.type === "delta" ? m.text : "")).join("");
  return { text: text || null, error: error ? describeError(error) : null, loading };
}
