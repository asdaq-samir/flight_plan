import { useCallback, useMemo, useState } from "react";
import { experimental_streamedQuery as streamedQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, describeError } from "../../../lib/api/client";
import { ended } from "../../../lib/api/streams";
import { pilotQuery } from "../../../lib/queryClient";
import { subscriptionQuery } from "../../../lib/subscription";

/** How to spot one checkpoint from the air. "saved" means a pilot's own
 *  earlier edit, not a fresh LLM generation; "error" means that one
 *  checkpoint's generation failed and `text` is empty, left for a
 *  pilot to fill in by hand -- keyed by lat/lon since that is how the
 *  server matches a checkpoint to its note too. */
export interface Description {
  text: string;
  source: "generated" | "saved" | "error";
}

export function descriptionKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * One "how to spot it" line per checkpoint, streamed on a pilot's own
 * click (the nav log's button) and never on its own: every line is an
 * LLM call. Once asked for, kept for the route.
 *
 * Keyed as the planner keeps them: per route and per pilot -- a
 * signed-in pilot's own edits are theirs alone, and after Log out the
 * next person must not see them -- and not per altitude, which the
 * request does not even send. The cache holds only what the stream
 * said; the pilot's own edits are the overlay below, never written into
 * it (writing a line in by hand made the query "fetched", and Generate
 * then did nothing for that route).
 *
 * Its own hook, beside usePlan rather than inside it: notes change for
 * their own reasons -- how they are generated, saved and kept -- and
 * none of them is the nav log's.
 */
export function useCheckpointNotes(dep: string, dest: string, stops: string[] = []) {
  const { data: pilot } = useQuery(pilotQuery);
  const pilotId = pilot?.id ?? null;
  const via = stops.join(",");
  const descriptions = useQuery({
    queryKey: ["descriptions", dep, dest, via, pilotId],
    queryFn: streamedQuery({
      // Ended or failed, never cut off unsaid: a stream that stopped half
      // way looked finished, and its error line was never shown (the
      // audit's finding). The notes that came before it stay.
      streamFn: ({ signal }) => ended(api.describeCheckpoints(dep, dest, signal, stops), "checkpoint descriptions"),
    }),
    enabled: false, staleTime: Infinity,
  });
  // The query's own refetch and flags, not its result, which is new at
  // every render: so was this, and with it the nav log drawn again at
  // every render of the page (as useNarratives).
  const { isFetching, isFetched, isError, refetch } = descriptions;
  // One of the month's runs (the subscription's cap): its count, asked
  // again once the run is done.
  const queryClient = useQueryClient();
  // Once a run has written them, not again; a run that failed, again.
  const generateDescriptions = useCallback(() => {
    if (isFetching || (isFetched && !isError)) return;
    void refetch().then(() => queryClient.invalidateQueries({ queryKey: subscriptionQuery.queryKey }));
  }, [isFetching, isFetched, isError, refetch, queryClient]);

  // The pilot's own edits, shown the moment they are made: an overlay
  // on the stream, scoped the same way. Written when the save starts;
  // a failed save takes its own text back out -- but only if the box
  // still holds that text, so a later edit of the same checkpoint that
  // did save is never undone by an earlier one's failure.
  const scope = `${dep}\u0000${dest}\u0000${via}\u0000${pilotId ?? ""}`;
  const [edits, setEdits] = useState<{ scope: string; notes: Record<string, string> }>({ scope, notes: {} });
  const descriptionMap = useMemo(() => {
    const map: Record<string, Description> = {};
    for (const m of descriptions.data ?? []) {
      if (m.type === "checkpoint") map[descriptionKey(m.lat, m.lon)] = { text: m.description ?? "", source: m.source };
    }
    if (edits.scope === scope) {
      for (const [key, text] of Object.entries(edits.notes)) map[key] = { text, source: "saved" };
    }
    return map;
  }, [descriptions.data, edits, scope]);
  const descriptionError = descriptions.error ? describeError(descriptions.error, "The descriptions could not be written") : null;
  const descriptionProgress = useMemo(() => {
    if (!descriptions.isFetching) return null;
    const started = (descriptions.data ?? []).find(m => m.type === "start");
    const done = (descriptions.data ?? []).filter(m => m.type === "checkpoint").length;
    return { done, total: started && started.type === "start" ? started.count : 0 };
  }, [descriptions.data, descriptions.isFetching]);

  const saveNote = useMutation({
    mutationFn: ({ lat, lon, text }: { lat: number; lon: number; text: string }) =>
      api.saveCheckpointNote(dep, dest, lat, lon, text, stops),
    onMutate: ({ lat, lon, text }) => {
      const key = descriptionKey(lat, lon);
      setEdits(current => ({
        scope, notes: { ...(current.scope === scope ? current.notes : {}), [key]: text },
      }));
      return { scope, key, text };
    },
    onError: (_error, _vars, context) => {
      if (!context) return;
      setEdits(current => {
        if (current.scope !== context.scope || current.notes[context.key] !== context.text) return current;
        const { [context.key]: _failed, ...rest } = current.notes;
        return { scope: current.scope, notes: rest };
      });
    },
  });
  // The save's own promise, so the note's box can keep a pilot's typing
  // until it is safely saved (DescriptionCell).
  // The mutation's own mutateAsync, which keeps its identity, for the same
  // reason.
  const { mutateAsync } = saveNote;
  const saveDescription = useCallback(
    (lat: number, lon: number, text: string) => mutateAsync({ lat, lon, text }),
    [mutateAsync],
  );

  return { descriptions: descriptionMap, descriptionError, descriptionProgress, generateDescriptions, saveDescription };
}
