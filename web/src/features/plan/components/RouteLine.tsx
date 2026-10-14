import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../../../lib/text";

/**
 * The route at rest, the pill's one row -- or a card's name, its close at
 * its end -- as the panel of 2026-10-11 had it
 * and the owner picked it back: Share at its start, and where to, how far
 * and how long ("KDLH · 324 nm · 2h 56m"), a tap on it the sheet half way.
 * What is wrong with the route is a red mark beside it, which it does not
 * hide. The search bar's height, so every tab's pill is one row alike.
 */
export default function RouteLine({ line, label, warning, onOpen, leading, trailing }: {
  line: string;
  /** What a screen reader hears: the route whole. */
  label: string;
  warning?: string;
  onOpen: () => void;
  leading?: ReactNode;
  /** At its end: a card's close. */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      {leading && <div className="flex shrink-0">{leading}</div>}
      <button
        type="button" onClick={onOpen} data-testid="route-line" data-tone={warning ? "destructive" : "default"}
        aria-label={[label, line, warning].filter(Boolean).join(", ")}
        // Over the grabber's hit area (index.css), which reaches down across
        // its top: the route is what a tap there means, the grabber's own
        // the drag.
        className="z-10 flex h-[2.5625rem] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {warning && <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />}
        <span className={cn("truncate font-semibold tabular-nums", TEXT.row)}>{line}</span>
      </button>
      {/* As wide as the other side, so the line is centred. */}
      {trailing ? <div className="flex shrink-0">{trailing}</div> : leading && <div className="w-9 shrink-0" aria-hidden="true" />}
    </div>
  );
}
