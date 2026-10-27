import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { TEXT } from "../lib/text";
import { observed, planStateOf, redone, restored, started, undone, type PlanHistory } from "../lib/planHistory";

/** One Undo bar at a time: the next edit's takes its place. */
const UNDO_TOAST = "plan-undo";
/** Long enough to read the words and reach the button, as iOS's own
 *  undo banners stay. */
const UNDO_MS = 4000;

/** Typing in a field undoes the field's own text, the browser's way. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The plan's Undo and Redo (lib/planHistory), from the address the page
 * keeps it in: each change of the route taken in as it lands, whichever
 * button made it. One that took something away -- the route cleared, a
 * stop removed, the route replaced by Fly Here or a Direct to, a
 * procedure taken off -- puts up "Route cleared · Undo" for six seconds,
 * in the app's one place for news that goes by itself (AppToaster). A
 * keyboard's Cmd-Z or Ctrl-Z undoes any step, Shift with it (or Ctrl-Y)
 * redoes it.
 */
export function usePlanHistory(searchParams: URLSearchParams, setSearchParams: SetURLSearchParams) {
  const history = useRef<PlanHistory | null>(null);
  const state = useMemo(() => planStateOf(searchParams), [searchParams]);

  const go = useCallback((step: typeof undone) => {
    if (!history.current) return false;
    const next = step(history.current, Date.now());
    if (!next) return false;
    history.current = next;
    toast.dismiss(UNDO_TOAST);
    setSearchParams(prev => restored(prev, next.now), { replace: true });
    return true;
  }, [setSearchParams]);
  const undo = useCallback(() => go(undone), [go]);
  const redo = useCallback(() => go(redone), [go]);

  useEffect(() => {
    const now = Date.now();
    if (!history.current) {
      history.current = started(state, now);
      return;
    }
    const { history: next, note } = observed(history.current, state, now);
    history.current = next;
    if (!note) return;
    toast(note, {
      id: UNDO_TOAST,
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => { undo(); } },
      classNames: {
        // The blue tint of what is tapped, and a 44-point hit area made
        // round the button rather than the button grown (CLAUDE.md).
        actionButton: cn(TEXT.row, "bg-transparent! text-tint! font-semibold relative after:absolute after:-inset-x-3 after:-inset-y-3"),
      },
    });
  }, [state, undo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || typing(event.target)) return;
      const key = event.key.toLowerCase();
      const wanted = key === "z" ? (event.shiftKey ? redo : undo) : key === "y" && event.ctrlKey ? redo : null;
      if (wanted?.()) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return { undo, redo };
}
