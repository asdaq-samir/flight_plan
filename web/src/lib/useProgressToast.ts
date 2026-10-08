import { useEffect, useRef } from "react";
import { toast } from "sonner";

const PROGRESS_ID = "page-progress";

/** How long the page may be at work before it says what on: a route the
 *  planner has planned before is in, all of it, in less (0.1 s from the
 *  planner), and a toast put up for it and taken down at once was a
 *  flicker -- and on a phone, the page laid out again in the middle of the
 *  route's own first frame (sonner measures each toast it shows),
 *  measured 2026-10-08. */
const SHOW_AFTER_MS = 400;

/**
 * The page's progress line, one sonner toast (the one `<Toaster>` in
 * main.tsx) updated in place: a route's own sequence ("Drawing
 * course…" -> "Scoring checkpoints…" -> "Planning cruise altitudes…") is one
 * operation's status narrating itself over time, not several
 * concurrent ones, so it should never pile up a toast per stage.
 * Shown once the page has been at work a moment (SHOW_AFTER_MS), from
 * the first stage on, not each: whatever it is on by then. Failures are
 * the query client's to report (queryClient.ts), not this hook's.
 */
export function useProgressToast(progress: string | null) {
  const busySince = useRef<number | null>(null);
  const shown = useRef(false);
  useEffect(() => {
    if (!progress) {
      busySince.current = null;
      if (shown.current) toast.dismiss(PROGRESS_ID);
      shown.current = false;
      return;
    }
    const show = () => {
      shown.current = true;
      toast.loading(progress, { id: PROGRESS_ID, duration: 4000 });
    };
    if (shown.current) {
      show();
      return;
    }
    busySince.current ??= performance.now();
    const later = window.setTimeout(show, busySince.current + SHOW_AFTER_MS - performance.now());
    return () => window.clearTimeout(later);
  }, [progress]);

  useEffect(() => () => {
    toast.dismiss(PROGRESS_ID);
  }, []);
}
