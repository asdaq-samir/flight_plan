import { useCallback } from "react";
import { experimental_streamedQuery as streamedQuery, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, describeError } from "../../../lib/api/client";
import { ended } from "../../../lib/api/streams";
import type { Leg, NarrativeMessage, NarrativeRequest, NavLogAltitude } from "../../../lib/api/types";

export type Framework = "langgraph" | "crewai";

/** One framework's own narrative as it streams: the text so far (or
 *  the whole briefing once done), why there is none, and whether it
 *  is still being written. */
export interface FrameworkNarrative {
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
 * Each framework's narrative about the nav log on screen -- a pilot's
 * own click per framework, each a real, billed Claude call. Only about
 * a log that is flown: with no winds there are no legs.
 *
 * Its own hook, beside usePlan rather than inside it: what the agents
 * are sent and how their streams are read change for the comparison's
 * reasons, not the nav log's.
 */
export function useNarratives({ dep, dest, planKey, nav, legs, whole }: NarrativeInput) {
  const request: NarrativeRequest | null = nav && nav.altitude_ft !== null && nav.flown !== null ? {
    departure_ident: dep, destination_ident: dest, aircraft_name: nav.aircraft.name,
    altitude_ft: nav.altitude_ft, altitude_selection: nav.altitude_selection, flown: nav.flown, legs,
  } : null;
  // The nav log's own key, not a few fields of it: this one left out the
  // departure time, the choice of plan, Load and the aeroplane's own
  // numbers, and held the leg count, which changes while legs stream --
  // so a narrative could be shown, or printed, beside a different log.
  const narrativeQuery = (framework: Framework) => ({
    queryKey: ["narrative", framework, ...planKey],
    queryFn: streamedQuery({
      streamFn: ({ signal }: { signal: AbortSignal }) =>
        ended(api.frameworkNarrative(framework, request!, signal), `${framework} narrative`),
    }),
    enabled: false, staleTime: Infinity,
  });
  const langgraph = useQuery(narrativeQuery("langgraph"));
  const crewai = useQuery(narrativeQuery("crewai"));
  const generateNarrative = useCallback((framework: Framework) => {
    // Only a whole log: the request carries its legs, and a narrative of
    // half of them would be kept for this key as if it were the whole.
    if (!whole) { toast.error("The nav log isn't fully loaded yet."); return; }
    void (framework === "langgraph" ? langgraph : crewai).refetch();
  }, [whole, langgraph, crewai]);

  return { langgraphNarrative: narrativeOf(langgraph), crewaiNarrative: narrativeOf(crewai), generateNarrative };
}

function narrativeOf(query: UseQueryResult<NarrativeMessage[]>): FrameworkNarrative {
  const chunks = query.data ?? [];
  const done = chunks.find(m => m.type === "done");
  const text = done && done.type === "done" ? done.briefing : chunks.map(m => (m.type === "delta" ? m.text : "")).join("");
  return { text: text || null, error: query.error ? describeError(query.error) : null, loading: query.isFetching };
}
