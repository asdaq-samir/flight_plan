import { useEffect, useRef } from "react";
import { toast } from "sonner";

const PROGRESS_ID = "page-progress";
const errorToastId = (key: string) => `page-error-${key}`;

/**
 * The progress toast and the error toasts every page with a live
 * course/stream has -- all go through sonner's own global toast stack
 * (`<Toaster>` in main.tsx) rather than a bespoke floating status line
 * and full-width error drawer. A toast floats over the map instead of
 * reserving space and shrinking it the way the old drawer did -- traded
 * away on purpose (see the session that replaced `ErrorTab`/`MapArea`'s
 * own `errorHeight` threading with this) for not having to hand-maintain
 * that threading through every page and every floating element that
 * needed to dodge it.
 *
 * `errors` is a named map, not one pre-combined string -- PlanView's
 * own three sources (a general plan error, a briefing failure, a
 * checkpoint-description failure) used to be squashed into one slot
 * via a `??`/`||` chain, so only whichever happened to win was ever
 * visible; two unrelated failures are two different things a pilot
 * needs to see and act on, not one silently hiding the other. Each key
 * gets its own toast, keyed by name so that source's own message
 * updates in place (not a fresh stacked duplicate) when it changes,
 * while two different keys never replace each other. `progress` stays
 * a single slot on purpose, unlike `errors` -- a route's own sequence
 * ("Drawing course…" -> "Scoring checkpoints…" -> "Planning… 60%") is
 * one operation's status narrating itself over time, not several
 * concurrent ones, and should keep updating in place rather than
 * piling up a toast per stage.
 *
 * No `position` override here -- every page that calls this shares one
 * `<Toaster>` (main.tsx), already anchored bottom-center for the whole
 * app, so there's nothing left for an individual toast to override.
 */
export function usePageStatus(
  progress: string | null,
  errors: Record<string, string | null>,
) {
  useEffect(() => {
    if (progress) toast.loading(progress, { id: PROGRESS_ID, duration: 4000 });
    else toast.dismiss(PROGRESS_ID);
  }, [progress]);

  // Every error-toast id this hook has ever actually shown, across
  // renders -- not just whichever are active on the render that
  // happens to unmount -- so the cleanup effect below can dismiss all
  // of them even if a caller's own set of named sources changed
  // during its lifetime.
  const shownIds = useRef(new Set<string>());
  const serializedErrors = JSON.stringify(errors);

  useEffect(() => {
    for (const [key, message] of Object.entries(errors)) {
      const id = errorToastId(key);
      if (message) {
        toast.error(message, { id, duration: Infinity });
        shownIds.current.add(id);
      } else {
        toast.dismiss(id);
      }
    }
    // `errors` is a fresh object every render; `serializedErrors` (its
    // own content, not its identity) is what should actually
    // re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializedErrors]);

  // A separate, mount-once effect purely for its cleanup -- the two
  // above already dismiss on every value change, but neither runs
  // again once the page that called this hook has actually navigated
  // away, so whatever toast was showing at that exact moment would
  // otherwise keep sitting there (sonner's own `<Toaster>` is one
  // global instance in main.tsx, outside the router, so it has no
  // idea a "page" went away at all). This is what actually clears it.
  useEffect(() => () => {
    toast.dismiss(PROGRESS_ID);
    shownIds.current.forEach(id => toast.dismiss(id));
  }, []);
}
