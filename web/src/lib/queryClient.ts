import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { describeError } from "./api/client";

declare module "@tanstack/react-query" {
  interface Register {
    /** `silent`: no toast for this query's failure -- the page shows
     *  it in place (a route that has not been collected offers to
     *  collect it) -- either outright or for the errors a function
     *  picks out. */
    queryMeta: { silent?: boolean | ((error: unknown) => boolean) };
    /** `silent`: the mutation reports its own failure. */
    mutationMeta: { silent?: boolean };
  }
}

/**
 * The one query client, with every failure reported in one place: a
 * query that fails toasts the server's own word for it with a "Try
 * again" that refetches it, a mutation that fails toasts the same,
 * and neither page threads error strings around to say so. The
 * exceptions are marked on the query or mutation itself (`meta`).
 *
 * No retries and no refetch on focus: the planner's calls are chart
 * reads, model inferences and streams of legs, and a pilot switching
 * back to the tab does not want the nav log recomputed under them.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const silent = query.meta?.silent;
      if (silent === true || (typeof silent === "function" && silent(error))) return;
      failed(describeError(error));
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return;
      failed(describeError(error));
    },
  }),
});

/**
 * One toast per distinct thing that went wrong, not one per call that
 * hit it.
 *
 * The id used to be the query's own hash, which meant a planner that is
 * down produced a separate toast for the course, the detection stream
 * and the nav log -- three identical "planner service unreachable" lines
 * stacked up the screen, each offering to retry a third of the page.
 * Keyed by the message instead, the three collapse into one, and its
 * Try again refetches everything currently in error rather than the one
 * query that happened to toast last. When a single call fails on its
 * own, that is still exactly one retry.
 */
function failed(message: string) {
  toast.error(message, {
    id: `failed:${message}`,
    duration: 10000,
    action: {
      label: "Try again",
      onClick: () => void queryClient.refetchQueries({
        predicate: query => query.state.status === "error",
      }),
    },
  });
}
