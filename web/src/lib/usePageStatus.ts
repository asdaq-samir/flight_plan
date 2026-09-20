import { useEffect, useRef } from "react";
import { toast } from "sonner";

const PROGRESS_ID = "page-progress";
const errorToastId = (key: string) => `page-error-${key}`;

/** One named error source: a message, or a message with a retry the
 *  toast offers as its action. `null` clears that source's toast. */
export type PageError = string | null | { message: string; retry?: () => void };

/**
 * Every info, warning and error message in this app is a sonner toast
 * (the one `<Toaster>` in main.tsx), not an inline banner: a toast
 * floats over the map instead of reserving space and shrinking it, and
 * every page reports the same way. What stays inline is content, not
 * status: a printed briefing's own caveats, an empty table's placeholder,
 * a form field's validation, a decision with a button of its own.
 *
 * `errors` is a named map, not one pre-combined string -- PlanView's
 * own sources (a general plan error, the nav log, the briefing, the
 * checkpoint descriptions) used to be squashed into one slot, so only
 * whichever happened to win was ever visible; two unrelated failures
 * are two different things a pilot needs to see and act on. Each key
 * gets its own toast, keyed by name so that source's own message
 * updates in place when it changes, while two different keys never
 * replace each other. Error toasts stay until the source clears or the
 * page is left; one that offers a retry carries it as the toast's own
 * action, so a failure a pilot can do something about does not need a
 * banner to hold the button.
 */
export function useErrorToasts(errors: Record<string, PageError>) {
  // Every error-toast id this hook has ever actually shown, across
  // renders -- not just whichever are active on the render that
  // happens to unmount -- so the cleanup effect below can dismiss all
  // of them even if a caller's own set of named sources changed
  // during its lifetime.
  const shownIds = useRef(new Set<string>());
  // The latest sources, for the effect below to read: `errors` is a
  // fresh object every render, and its content (not its identity, and
  // not the retry functions) is what should re-trigger that effect, so
  // it keys on the serialised form and reads the real one from here.
  const latest = useRef(errors);
  useEffect(() => {
    latest.current = errors;
  });
  const serializedErrors = JSON.stringify(errors);

  useEffect(() => {
    for (const [key, entry] of Object.entries(latest.current)) {
      const id = errorToastId(key);
      const message = typeof entry === "string" ? entry : entry?.message ?? null;
      const retry = typeof entry === "object" && entry ? entry.retry : undefined;
      if (message) {
        toast.error(message, {
          id, duration: Infinity,
          action: retry ? { label: "Try again", onClick: retry } : undefined,
        });
        shownIds.current.add(id);
      } else {
        toast.dismiss(id);
      }
    }
  }, [serializedErrors]);

  // A separate, mount-once effect purely for its cleanup -- the one
  // above dismisses on every value change, but never runs again once
  // the component that called this hook has gone (sonner's `<Toaster>`
  // is one global instance outside the router, so it has no idea a
  // page went away). This is what actually clears them.
  useEffect(() => () => {
    shownIds.current.forEach(id => toast.dismiss(id));
  }, []);
}

/**
 * The page's progress line plus its error sources. `progress` is a
 * single slot on purpose, unlike `errors` -- a route's own sequence
 * ("Drawing course…" -> "Scoring checkpoints…" -> "Planning… 60%") is
 * one operation's status narrating itself over time, not several
 * concurrent ones, and should keep updating in place rather than piling
 * up a toast per stage.
 */
export function usePageStatus(progress: string | null, errors: Record<string, PageError>) {
  useEffect(() => {
    if (progress) toast.loading(progress, { id: PROGRESS_ID, duration: 4000 });
    else toast.dismiss(PROGRESS_ID);
  }, [progress]);

  useEffect(() => () => {
    toast.dismiss(PROGRESS_ID);
  }, []);

  useErrorToasts(errors);
}
