import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

interface Props {
  /** What the trigger says -- each page names its own settings. */
  label: string;
  /** Sits in the header row at all times, open or closed -- the
   *  page's own name ("VFR planner"). */
  title?: ReactNode;
  children: ReactNode;
}

/**
 * The toolbar's own settings drawer, as shadcn's `Collapsible` --
 * closed by default on every load, opened by clicking the trigger
 * (no drag-to-any-height: that was `react-resizable-panels`' own
 * continuous physics, traded away here for shadcn's plain open/closed
 * primitive). `max-h-[50vh]` on the open content is this component's
 * own safety net, not something the old drag version needed -- there,
 * a pilot's own drag motion naturally stopped short of swallowing the
 * whole screen; here, a tap fully opens in one step, so unusually
 * tall content (a long form on a short phone screen) gets its own
 * scrollbar instead of pushing the map off screen entirely.
 */
export default function CollapsibleToolbar({ label, title, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm print:hidden"
    >
      <div className="flex items-center justify-between px-3 py-1">
        {title && <div className="text-lg font-bold tracking-tight text-slate-900">{title}</div>}
        <CollapsibleTrigger
          data-testid="toolbar-trigger"
          className="group flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
        >
          {label}
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent data-testid="toolbar-content">
        <div className="max-h-[50vh] space-y-2 overflow-y-auto px-3 pb-2 pt-1 shadow-md">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
