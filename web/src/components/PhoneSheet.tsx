import { useRef, useState, type ComponentProps, type PointerEvent } from "react";
import { cn } from "cn";
import { SheetClose, SheetContent } from "./ui/sheet";
import type { NavEdge } from "../lib/preferences";

/** A swipe toward the sheet's edge, let go, puts it away past this share
 *  of its height, or faster than this many points a millisecond: a
 *  flick, as an iOS sheet's. */
const AWAY_SHARE = 0.3;
const AWAY_SPEED = 0.5;

/** How far a finger goes before a press is a swipe: iOS's ten points, as
 *  the map's sheet waits for (useDetentDrag). */
const SLOP = 10;

/** As the map's sheet settles (SHEET_SECONDS): ease-out, a third of a
 *  second. */
const BACK = "transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)";

/**
 * A phone's sheet, as the map's own floating sheet is (MapPanel), at the
 * owner's pick of the sheets audit (D1, 2026-10-17), where it was opaque,
 * edge to edge and square-cornered: Liquid Glass as frosted as the half
 * sheet, eight points in from the screen's sides and its edge, the half
 * sheet's 36-point corners and its grabber. A swipe toward its edge on
 * the grabber, or on a head marked `data-swipe-handle`, takes it with the
 * finger and, let go far or fast enough, puts it away. Sized to what it
 * holds, at most 85% of the screen. shadcn's SheetContent under it.
 */
export function PhoneSheetContent({ edge, className, style, children, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, ...props }:
  Omit<ComponentProps<typeof SheetContent>, "side" | "glass" | "showCloseButton"> & { edge: NavEdge }) {
  const close = useRef<HTMLButtonElement>(null);
  const press = useRef<{ id: number; y: number; t: number; height: number; moved: boolean } | null>(null);
  // How far it has been swiped toward its edge, while a finger has it or
  // as it eases back; null at rest.
  const [swiped, setSwiped] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const toward = edge === "bottom" ? 1 : -1;
  return (
    <SheetContent
      side={edge} glass showCloseButton={false} data-floating=""
      className={cn("max-h-[calc(85dvh-1rem)] gap-0 rounded-[36px]", className)}
      style={swiped === null ? style : { ...style, transform: `translateY(${toward * swiped}px)`, transition: held ? "none" : BACK }}
      onPointerDown={event => {
        onPointerDown?.(event);
        if (event.button !== 0 || !(event.target as Element).closest("[data-swipe-handle]")) return;
        press.current = { id: event.pointerId, y: event.clientY, t: event.timeStamp, height: event.currentTarget.offsetHeight, moved: false };
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        onPointerMove?.(event);
        const p = press.current;
        if (!p || event.pointerId !== p.id) return;
        const by = (event.clientY - p.y) * toward;
        if (!p.moved) {
          if (Math.abs(by) < SLOP) return;
          p.moved = true;
          setHeld(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        // With the finger toward its edge; away from it, a quarter as
        // far, as it gives at its full height.
        setSwiped(by > 0 ? by : by / 4);
      }}
      onPointerUp={event => {
        onPointerUp?.(event);
        const p = press.current;
        press.current = null;
        if (!p || event.pointerId !== p.id || !p.moved) return;
        setHeld(false);
        const by = (event.clientY - p.y) * toward;
        if (by > p.height * AWAY_SHARE || by / Math.max(1, event.timeStamp - p.t) > AWAY_SPEED) close.current?.click();
        else setSwiped(0);
      }}
      onPointerCancel={event => {
        onPointerCancel?.(event);
        const p = press.current;
        press.current = null;
        if (!p?.moved) return;
        setHeld(false);
        setSwiped(0);
      }}
      {...props}
    >
      {/* iOS's grabber, 36 by 5, five points in from the sheet's far edge,
          in a strip the finger can take it by. */}
      <div
        aria-hidden="true" data-swipe-handle=""
        className={cn("absolute inset-x-0 z-10 flex h-4 touch-none justify-center", edge === "bottom" ? "top-0 items-start pt-[5px]" : "bottom-0 items-end pb-[5px]")}
      >
        <span className="h-[5px] w-9 rounded-full bg-muted-foreground/40" />
      </div>
      {children}
      {/* What a swipe away presses: the sheet's own close, as its × does. */}
      <SheetClose ref={close} hidden tabIndex={-1} aria-hidden="true" />
    </SheetContent>
  );
}
