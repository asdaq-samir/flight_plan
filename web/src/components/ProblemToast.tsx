import { CircleAlert, Minus, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import type { Problem } from "../lib/notify";
import { TEXT } from "../lib/text";

/** The status colours sonner's own error and warning toasts have, their
 *  words darker in the light theme for 4.5:1 (as index.css darkens the
 *  stock toasts'). */
const TONE = {
  error: "border-[var(--error-border)] bg-[var(--error-bg)] text-[hsl(359_100%_37%)] dark:text-[var(--error-text)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[hsl(31_92%_34%)] dark:text-[var(--warning-text)]",
};

/**
 * A problem's toast (lib/notify): open, its title, reasons as a list and
 * what can be done about it, and a minimize; folded, its icon and title
 * on one line, a tap opening it again. No close: a problem is put away
 * when what caused it has gone (lib/notify), and until then it is a
 * line at the edge of the screen, not something lost.
 */
export default function ProblemToast({ problem, minimized, onOpen, onMinimize, onHold, onLetGo, onAction }: {
  problem: Problem;
  minimized: boolean;
  onOpen: () => void;
  onMinimize: () => void;
  onHold: () => void;
  onLetGo: () => void;
  /** An action taken: the problem's way on, which puts it away. */
  onAction: () => void;
}) {
  const kind = problem.kind ?? "error";
  const Icon = kind === "warning" ? TriangleAlert : CircleAlert;
  if (minimized) {
    return (
      <div
        className={cn("flex w-full items-center gap-1 rounded-full border py-1 pr-3 pl-3 shadow-md", TONE[kind])}
        data-problem="minimized" data-kind={kind}
      >
        <button
          type="button" onClick={onOpen} aria-expanded={false} data-testid="problem-open"
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left outline-none focus-visible:underline"
        >
          <Icon className="size-4 shrink-0" />
          <span className={cn("truncate font-medium", TEXT.detail)}>{problem.title}</span>
        </button>
      </div>
    );
  }
  return (
    <div
      className={cn("flex w-full gap-2.5 rounded-[var(--radius)] border p-3 pr-1.5 shadow-lg", TONE[kind])}
      onPointerEnter={onHold} onPointerLeave={onLetGo} onFocusCapture={onHold} onBlurCapture={onLetGo}
      data-problem="open" data-kind={kind}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className={cn("font-semibold", TEXT.row)}>{problem.title}</div>
        {problem.description && <p className={TEXT.detail}>{problem.description}</p>}
        {!!problem.points?.length && (
          <ul className={cn("list-disc space-y-0.5 pl-4", TEXT.detail)}>
            {problem.points.map(point => <li key={point}>{point}</li>)}
          </ul>
        )}
        {!!problem.actions?.length && (
          <div className="flex flex-wrap gap-2 pt-1">
            {problem.actions.map(action => (
              <Button
                key={action.label} type="button" size="sm" variant="outline" data-testid={action.testId}
                className="text-foreground"
                onClick={() => { action.onClick(); if (!action.keepOpen) onAction(); }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
        {problem.extra}
      </div>
      <button
        type="button" aria-label="Minimize" onClick={onMinimize} data-testid="problem-minimize"
        className="flex size-7 shrink-0 items-center justify-center rounded-full opacity-80 outline-none hover:bg-current/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Minus className="size-4" />
      </button>
    </div>
  );
}
