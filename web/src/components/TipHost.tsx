import { useEffect, useRef, useState } from "react";
import { Lightbulb } from "lucide-react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { TEXT } from "../lib/text";
import { TIPS, unseen, useTips, type TipSpec } from "../lib/tips";

/** In sight and not under anything: the point at its middle is its own.
 *  Not in the panel at rest: there the pill is the tab bar and a strip
 *  under it, and a tip over the strip (the route's figures') covered the
 *  tabs -- a tip waits for the panel to be up. */
function inSight(el: Element): boolean {
  if (el.closest("[data-capsule]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
  if (el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 20), 0), innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  return !!hit && (el === hit || el.contains(hit));
}

/** Something else up over the page -- a sheet, a menu, a popover: a tip
 *  waits for it to go. */
const somethingOpen = () =>
  !!document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='menu'], [data-slot='popover-content']:not([data-tip-content])");

/**
 * The planner's first-run tips (lib/tips), one at a time, as TipKit shows
 * a popover tip: beside its control (`data-tip`) once the control has
 * been in sight a moment and nothing else is up, a light to say it is a
 * tip, and the app's close (CloseButton) at its title row's end, as every
 * sheet has it. Closed, or put away by a tap elsewhere -- the pilot
 * moving on -- it is seen and not offered again on this device. The
 * stock popover, anchored to the control without wrapping it.
 */
export default function TipHost() {
  const seen = useTips(s => s.seen);
  const see = useTips(s => s.see);
  const [current, setCurrent] = useState<TipSpec | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const waiting = TIPS.filter(t => unseen(seen, t.id));
  const waitingKey = waiting.map(t => t.id).join(",");

  useEffect(() => {
    if (!waitingKey) return;
    const ids = waitingKey.split(",");
    // Found in sight on two looks running before it is offered: not a
    // control passing by as the panel moves.
    let candidate: string | null = null;
    const look = () => {
      const up = anchor.current;
      if (up) {
        if (!up.isConnected || !inSight(up)) { anchor.current = null; setCurrent(null); }
        return;
      }
      if (somethingOpen()) { candidate = null; return; }
      const found = ids.map(id => ({ id, el: document.querySelector<HTMLElement>(`[data-tip="${id}"]`) }))
        .find(t => t.el && inSight(t.el));
      if (!found) { candidate = null; return; }
      if (candidate !== found.id) { candidate = found.id; return; }
      anchor.current = found.el;
      setCurrent(TIPS.find(t => t.id === found.id) ?? null);
    };
    const timer = window.setInterval(look, 700);
    return () => window.clearInterval(timer);
  }, [waitingKey]);

  const done = () => {
    if (current) see(current.id);
    anchor.current = null;
    setCurrent(null);
  };

  if (!current) return null;
  return (
    <Popover open onOpenChange={open => { if (!open) done(); }} modal={false}>
      <PopoverAnchor virtualRef={anchor as React.RefObject<HTMLElement>} />
      <PopoverContent
        side="bottom" align="start" sideOffset={10} collisionPadding={12}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0.5 p-3"
        onOpenAutoFocus={e => e.preventDefault()}
        data-tip-content="" data-testid="tip" aria-label={current.title}
      >
        <div className="flex items-center gap-3">
          <Lightbulb className="size-5 shrink-0 text-tint" aria-hidden />
          <p className={cn("min-w-0 flex-1 font-semibold", TEXT.row)}>{current.title}</p>
          <CloseButton label="Close the tip" className="-my-1 -mr-1" onClick={done} data-testid="tip-close" />
        </div>
        {/* Under the title, in line with it past the light. */}
        <p className={cn("pl-8", TEXT.prose)}>{current.message}</p>
      </PopoverContent>
    </Popover>
  );
}
