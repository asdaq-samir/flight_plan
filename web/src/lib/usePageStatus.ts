import { useEffect } from "react";
import { toast } from "sonner";

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
 */
export function usePageStatus(progress: string | null, error: string | null) {
  useEffect(() => {
    if (progress) toast.loading(progress, { id: PROGRESS_ID, duration: 4000 });
    else toast.dismiss(PROGRESS_ID);
  }, [progress]);

  useEffect(() => {
    if (error) toast.error(error, { id: ERROR_ID, duration: Infinity });
    else toast.dismiss(ERROR_ID);
  }, [error]);
}
