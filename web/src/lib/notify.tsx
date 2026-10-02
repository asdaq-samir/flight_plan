import type { ReactNode } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import ProblemToast from "../components/ProblemToast";

/** Something gone wrong, or worth a warning, as a toast that stays. */
export interface Problem {
  kind?: "error" | "warning";
  title: string;
  description?: string | null;
  /** Its reasons, as a list under the description. */
  points?: string[];
  /** What can be done about it, as buttons under it; a tap closes it
   *  unless `keepOpen`. */
  actions?: { label: string; onClick: () => void; keepOpen?: boolean; testId?: string }[];
  /** Anything else it offers, under the actions: a field to type in. */
  extra?: ReactNode;
}

/** How long a problem stays open before it folds to its one line. */
export const MINIMIZE_MS = 8000;

const timers = new Map<string | number, ReturnType<typeof setTimeout>>();

/** The problems folded to their line just now: while one is, a phone's
 *  sheet all the way out stops short of it (MapPanel, ConsoleSheet), so
 *  its grabber is not under the line. */
export const useFoldedProblems = create<{ ids: (string | number)[] }>(() => ({ ids: [] }));

/** What folded lines take of the screen's edge, with a gap under them:
 *  the room a sheet all the way out leaves them -- a line, and sonner's
 *  stack showing 14 of each one behind it, of the three it shows. */
export function foldedProblemsPx(count: number): number {
  return count ? 46 + Math.min(count - 1, 2) * 14 : 0;
}

function folded(id: string | number, is: boolean) {
  useFoldedProblems.setState(s => ({ ids: is ? [...s.ids.filter(x => x !== id), id] : s.ids.filter(x => x !== id) }));
}

/** Each problem on screen, by id: how to show it, and whether it is open. */
const shown = new Map<string | number, { show: (minimized: boolean) => void; open: boolean }>();

/** Which of a phone's sheets is out, reaching the toasts' edge of the
 *  screen (MapPanel at half or all the way, ConsoleSheet). */
const covering = { panel: false, console: false };

/**
 * A sheet out, or no longer: while one is, a problem is not left open
 * over it -- each open one folds to its line at once, and one raised
 * meanwhile comes folded. A tap on a line still opens it to be read; it
 * folds again as one does.
 */
export function sheetCovers(sheet: keyof typeof covering, covers: boolean) {
  covering[sheet] = covers;
  if (!covers) return;
  for (const { show, open } of [...shown.values()]) if (open) show(true);
}

function stop(id: string | number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

/**
 * An error or a warning, as a toast that does not go away by itself: open
 * for MINIMIZE_MS, with its reasons as a list and what can be done about
 * it, then folded to one line -- its icon and title, a pill at the edge
 * of the screen -- which a tap opens again. It stays open while a finger
 * or the keyboard's focus is in it, and its minimize folds it sooner.
 * There is no close: it goes when what caused it has gone -- the code
 * that raised it says so (dismissProblem), or one of its actions is
 * taken. A problem used to be a sonner toast that went after ten
 * seconds, whatever it said: a paragraph about the terrain gone before
 * it could be read. One id is one toast, updated in place (sonner's
 * own), so the same problem raised again is not two.
 */
export function notifyProblem(problem: Problem, id: string | number = `problem:${problem.title}`): string | number {
  const schedule = () => {
    stop(id);
    timers.set(id, setTimeout(() => show(true), MINIMIZE_MS));
  };
  const show = (minimized: boolean) => {
    stop(id);
    toast.custom(() => (
      <ProblemToast
        problem={problem} minimized={minimized}
        onOpen={() => show(false)} onMinimize={() => show(true)} onHold={() => stop(id)} onLetGo={schedule}
        onAction={() => dismissProblem(id)}
      />
    ), { id, duration: Infinity, onDismiss: () => { stop(id); folded(id, false); shown.delete(id); } });
    folded(id, minimized);
    shown.set(id, { show, open: !minimized });
    if (!minimized) schedule();
  };
  show(covering.panel || covering.console);
  return id;
}

/** Put away, from where it was raised: the problem has gone. */
export function dismissProblem(id: string | number) {
  stop(id);
  folded(id, false);
  shown.delete(id);
  toast.dismiss(id);
}
