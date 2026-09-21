import { useEffect } from "react";
import { toast } from "sonner";

const PROGRESS_ID = "page-progress";

/**
 * The page's progress line, one sonner toast (the one `<Toaster>` in
 * main.tsx) updated in place: a route's own sequence ("Drawing
 * course…" -> "Scoring checkpoints…" -> "Planning… 60%") is one
 * operation's status narrating itself over time, not several
 * concurrent ones, so it should never pile up a toast per stage.
 * Failures are the query client's to report (queryClient.ts), not
 * this hook's.
 */
export function useProgressToast(progress: string | null) {
  useEffect(() => {
    if (progress) toast.loading(progress, { id: PROGRESS_ID, duration: 4000 });
    else toast.dismiss(PROGRESS_ID);
  }, [progress]);

  useEffect(() => () => {
    toast.dismiss(PROGRESS_ID);
  }, []);
}
