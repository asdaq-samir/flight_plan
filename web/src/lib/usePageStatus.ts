import { useEffect } from "react";
import { toast, type ExternalToast } from "sonner";

// One id each, reused on every call -- sonner treats a second
// `toast.loading`/`toast.error` with the same id as an update to the
// existing toast (new text, timer restarted) rather than a second
// toast stacking underneath it.
const PROGRESS_ID = "page-progress";
const ERROR_ID = "page-error";

/**
 * The progress toast and the error toast every page with a live
 * course/stream has -- both go through sonner's own global toast
 * stack (`<Toaster>` in main.tsx) rather than a bespoke floating
 * status line and full-width error drawer. A toast floats over the
 * map instead of reserving space and shrinking it the way the old
 * drawer did -- traded away on purpose (see the session that replaced
 * `ErrorTab`/`MapArea`'s own `errorHeight` threading with this) for
 * not having to hand-maintain that threading through every page and
 * every floating element that needed to dodge it.
 *
 * `position` defaults to the Toaster's own default (`top-center` in
 * main.tsx, clear of every page's toolbar) -- a caller only needs to
 * override it when its own layout doesn't match that default, e.g.
 * PlanView's Flight Briefing sub-view has no toolbar row to clear but
 * does have real content starting right at the top, so it passes
 * "bottom-center" instead (nothing floats at the bottom of that view).
 */
export function usePageStatus(progress: string | null, error: string | null, position?: ExternalToast["position"]) {
  useEffect(() => {
    if (progress) toast.loading(progress, { id: PROGRESS_ID, duration: 4000, position });
    else toast.dismiss(PROGRESS_ID);
  }, [progress, position]);

  useEffect(() => {
    if (error) toast.error(error, { id: ERROR_ID, duration: Infinity, position });
    else toast.dismiss(ERROR_ID);
  }, [error, position]);

  // A separate, mount-once effect purely for its cleanup -- the two
  // above already dismiss on every value change, but neither runs
  // again once the page that called this hook has actually navigated
  // away, so whatever toast was showing at that exact moment would
  // otherwise keep sitting there (sonner's own `<Toaster>` is one
  // global instance in main.tsx, outside the router, so it has no
  // idea a "page" went away at all). This is what actually clears it.
  useEffect(() => () => {
    toast.dismiss(PROGRESS_ID);
    toast.dismiss(ERROR_ID);
  }, []);
}
