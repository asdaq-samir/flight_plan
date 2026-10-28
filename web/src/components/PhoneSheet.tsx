import { useEffect, useRef, useState, type ComponentProps, type PointerEvent, type ReactNode } from "react";
import { cn } from "cn";
import { SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { SHEET_CORNERS } from "./mapChrome";
import type { NavEdge } from "../lib/preferences";
import { TEXT } from "../lib/text";
import { useKeyboardInset, useVisualHeight } from "../hooks/use-viewport";

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
  Omit<ComponentProps<typeof SheetContent>, "side" | "glass"> & { edge: NavEdge }) {
  const close = useRef<HTMLButtonElement>(null);
  const press = useRef<{ id: number; y: number; t: number; height: number; moved: boolean } | null>(null);
  // How far it has been swiped toward its edge, while a finger has it or
  // as it eases back; null at rest.
  const [swiped, setSwiped] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const toward = edge === "bottom" ? 1 : -1;
  // Over the keyboard while it is up, as an iOS sheet rides up on it: at
  // the bottom, Safari leaves a fixed sheet where it was, under the
  // keyboard, and the address to sign in with was typed into out of
  // sight (the owner's screen recording, 2026-10-28). No taller than what
  // the keyboard leaves of the screen, at either edge.
  const keyboard = useKeyboardInset();
  const room = useVisualHeight();
  const lifted = keyboard > 0
    ? { ...(edge === "bottom" ? { bottom: keyboard + 8 } : {}), maxHeight: room - 16 }
    : null;
  // From its content too, as an iOS sheet's scrolling content hands a drag
  // to the sheet, at the owner's pick ("Ok 1-3"): a finger's first move
  // toward the sheet's edge, where everything that scrolls under it is
  // at its start, takes the sheet; anything else is the content's own
  // scroll. Decided at that first move, the one a page can still take
  // from the browser's scrolling (as the map's sheet's body, useDetentDrag).
  // A field, a slider or something with gestures of its own keeps the
  // finger; the head goes by its pointer (above).
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sheet) return;
    let g: { x: number; y: number; t: number; target: Element; taken: boolean | null; by: number; moving: boolean } | null = null;
    const atStart = (target: Element) => {
      for (let el: Element | null = target; el && el !== sheet; el = el.parentElement) {
        if (el.matches("input, textarea, [role=slider], [contenteditable=true], [data-swipe-handle]") || getComputedStyle(el).touchAction === "none") return false;
        const style = getComputedStyle(el);
        if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(style.overflowY)
          && (toward > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return false;
      }
      return true;
    };
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      g = touch && event.touches.length === 1 && event.target instanceof Element
        ? { x: touch.clientX, y: touch.clientY, t: event.timeStamp, target: event.target, taken: null, by: 0, moving: false } : null;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!g || !touch || event.touches.length !== 1) return;
      const dx = touch.clientX - g.x, by = (touch.clientY - g.y) * toward;
      if (g.taken === null) {
        if (dx === 0 && by === 0) return;
        g.taken = by > 0 && by > Math.abs(dx) && atStart(g.target);
        if (!g.taken) { g = null; return; }
      }
      if (event.cancelable) event.preventDefault();
      if (by < SLOP && !g.moving) return;
      g.by = by;
      if (!g.moving) setHeld(true);
      g.moving = true;
      setSwiped(by > 0 ? by : by / 4);
    };
    const end = (event: TouchEvent) => {
      const was = g;
      g = null;
      if (!was?.taken) return;
      if (event.cancelable) event.preventDefault();
      if (!was.moving) return;
      setHeld(false);
      const height = sheet.offsetHeight;
      if (was.by > height * AWAY_SHARE || was.by / Math.max(1, event.timeStamp - was.t) > AWAY_SPEED) close.current?.click();
      else setSwiped(0);
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end, { passive: false });
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
    };
  }, [sheet, toward]);
  return (
    // Its content clipped to its round corners, as an iOS sheet's is: a
    // list scrolled under its foot stood square past them (the owner's
    // screenshot of an approach's runways).
    <SheetContent
      ref={setSheet} side={edge} glass data-floating=""
      className={cn("max-h-[calc(85dvh-1rem)] gap-0 overflow-hidden", SHEET_CORNERS, className)}
      style={swiped === null ? { ...style, ...lifted } : { ...style, ...lifted, transform: `translateY(${toward * swiped}px)`, transition: held ? "none" : BACK }}
      onPointerDown={event => {
        onPointerDown?.(event);
        // Its own, not the map's sheet's: a sheet opened from inside the
        // map's sheet (the route's Procedures) is its child in React's tree
        // though portalled out of it in the page's, and a press here went
        // on up to the map sheet's head, whose drag (useDetentDrag) then
        // took the finger -- a swipe up on the Procedures dragged FPL up
        // behind it, at the owner's notice.
        event.stopPropagation();
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

/**
 * A phone's sheet's title row, as an iOS sheet's navigation bar is: its
 * title, the app's close (CloseButton) at the row's end -- or a form's
 * Cancel at its start and its Add or Set at its end, the title between --
 * and what the sheet is about under it. The row is what a swipe takes the
 * sheet away by, with the grabber, clear of which it starts.
 */
export function PhoneSheetHeader({ edge, title, description, leading, end }: {
  edge: NavEdge;
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <SheetHeader
      data-swipe-handle=""
      className={cn("touch-none flex-row flex-wrap items-center justify-between pb-2 text-left", edge === "bottom" && "pt-5")}
    >
      {leading}
      {/* A sheet's title at the app's size for one (TEXT). */}
      <SheetTitle className={cn("min-w-0 flex-1 font-semibold", TEXT.title, leading && "text-center")}>{title}</SheetTitle>
      {end}
      {description ? <SheetDescription className={cn("basis-full", TEXT.prose)}>{description}</SheetDescription> : null}
    </SheetHeader>
  );
}

/** A phone's sheet's room under its title row: its content scrolling
 *  there when it holds more than the sheet has room for (the keyboard
 *  up), clear of the grabber at its far edge and of the home indicator
 *  the sheet floats eight points over. */
export function PhoneSheetBody({ edge, className, ...props }: ComponentProps<"div"> & { edge: NavEdge }) {
  return (
    <div
      className={cn("min-h-0 overflow-y-auto px-4", edge === "top" ? "pb-5" : "pb-[max(1rem,calc(env(safe-area-inset-bottom)-0.5rem))]", className)}
      {...props}
    />
  );
}
