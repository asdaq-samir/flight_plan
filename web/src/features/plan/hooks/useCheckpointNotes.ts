import { useCallback, useMemo, useState } from "react";
import { experimental_streamedQuery as streamedQuery, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import { pilotQuery } from "../../../lib/queryClient";

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
export function useCheckpointNotes(dep: string, dest: string) {
  const { data: pilot } = useQuery(pilotQuery);
  const pilotId = pilot?.id ?? null;
  const descriptions = useQuery({
    queryKey: ["descriptions", dep, dest, pilotId],
    queryFn: streamedQuery({
      streamFn: ({ signal }) => api.describeCheckpoints(dep, dest, signal),
    }),
    enabled: false, staleTime: Infinity,
  });
  const generateDescriptions = useCallback(() => {
    if (descriptions.isFetching || descriptions.isFetched) return;
    void descriptions.refetch();
  }, [descriptions]);

  // The pilot's own edits, shown the moment they are made: an overlay
  // on the stream, scoped the same way. Written when the save starts;
  // a failed save takes its own text back out -- but only if the box
  // still holds that text, so a later edit of the same checkpoint that
  // did save is never undone by an earlier one's failure.
  const scope = `${dep}\u0000${dest}\u0000${pilotId ?? ""}`;
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
  const descriptionError = (descriptions.data ?? []).flatMap(m => (m.type === "error" ? [m.detail] : [])).at(-1) ?? null;
  const descriptionProgress = useMemo(() => {
    if (!descriptions.isFetching) return null;
    const started = (descriptions.data ?? []).find(m => m.type === "start");
    const done = (descriptions.data ?? []).filter(m => m.type === "checkpoint").length;
    return { done, total: started && started.type === "start" ? started.count : 0 };
  }, [descriptions.data, descriptions.isFetching]);

  const saveNote = useMutation({
    mutationFn: ({ lat, lon, text }: { lat: number; lon: number; text: string }) =>
      api.saveCheckpointNote(dep, dest, lat, lon, text),
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
  const saveDescription = useCallback(
    (lat: number, lon: number, text: string) => saveNote.mutateAsync({ lat, lon, text }),
    [saveNote],
  );

  return { descriptions: descriptionMap, descriptionError, descriptionProgress, generateDescriptions, saveDescription };
}
