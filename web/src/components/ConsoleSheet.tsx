import { useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "cn";
import { useDetentDrag } from "../hooks/use-detent-drag";
import { useKeyboardInset, useSafeArea, useVisualHeight, useWindowHeight } from "../hooks/use-viewport";
import { DialogOverlay, DialogPortal } from "./ui/dialog";
import { GLASS_SHEET, SHEET_DRAGGING, SHEET_INSET, SHEET_INSET_RADIUS, SHEET_MARGIN, SHEET_RESHAPE, SHEET_SETTLE } from "./mapChrome";

export type ConsoleDetent = "medium" | "large";

/** The grabber's strip: 16 tall, its pill five in from the sheet's edge. */
const GRABBER = 16;

/**
 * The console on a phone, from the navigation bar's edge either way, in
 * the map's panel's own shapes (MapPanel): it opens half way, in from the
 * screen's sides and its edge with every corner round and Liquid Glass
 * under it, as the panel is at half; dragged all the way, it meets the
 * edges and is opaque. The same drag as the panel's (useDetentDrag), on
 * its head and its grabber; dragged toward its edge past half, it goes.
 *
 * It was vaul's drawer from the bottom -- the screen's width at either
 * height, and its foot under the screen's edge at half, so it could not
 * stand in from it -- and a stock Sheet from the top, a slab with no
 * detents that ran its content past its own corners. A modal Radix
 * dialog still, as both were: the map waits, the focus stays in it,
 * Escape and a tap outside close it.
 */
export default function ConsoleSheet({
  open, onOpenChange, detent, onDetentChange, edge, header, children, onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detent: ConsoleDetent;
  onDetentChange: (detent: ConsoleDetent) => void;
  edge: "top" | "bottom";
  /** The console's title row: dragged as the grabber is. */
  header: ReactNode;
  children: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const fromBottom = edge === "bottom";
  const safe = useSafeArea();
  const windowHeight = useWindowHeight();
  const keyboard = useKeyboardInset();
  const visualHeight = useVisualHeight();
  // As the panel's: eight short of the far edge's inset, or of what is in
  // sight above the keyboard.
  const room = keyboard || visualHeight < windowHeight - 1
    ? visualHeight - Math.round(safe.top) - SHEET_MARGIN
    : windowHeight - Math.round(fromBottom ? safe.top : safe.bottom) - SHEET_MARGIN;
  const detents = { closed: 0, medium: Math.round(room / 2), large: room };
  const [dragged, setDragged] = useState<number | null>(null);
  const shown = dragged ?? detents[detent];
  const { startDrag, swallow } = useDetentDrag({
    detents, shown, fromBottom, setDragged,
    onRelease: next => (next === "closed" ? onOpenChange(false) : onDetentChange(next)),
  });
  const shape = shown >= (detents.medium + detents.large) / 2 ? "edge" : "inset";
  const gap = shape === "inset" ? SHEET_INSET : 0;
  // Under half it slides toward its edge, as a sheet being put away does,
  // rather than shrinking.
  const slide = Math.max(0, detents.medium - shown);
  // What of the screen's own insets the sheet is over: the status bar
  // above a sheet from the top, the home indicator under one from the
  // bottom (not with the keyboard up, which it sits on).
  const pad = Math.max(0, Math.round(fromBottom ? (keyboard ? 0 : safe.bottom) : safe.top) - gap);

  const grabber = (
    <div
      className={cn("flex shrink-0 touch-none justify-center", fromBottom ? "items-start pt-[5px]" : "items-end pb-[5px]")}
      style={{ height: GRABBER }} onPointerDown={startDrag} aria-hidden="true"
    >
      <div className="h-[5px] w-9 rounded-full bg-muted-foreground/40" data-grabber="" />
    </div>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        {/* A lighter dim than a dialog's: the glass at half shows the
            chart, and a tap on it closes the console. */}
        <DialogOverlay className="bg-black/20" />
        <DialogPrimitive.Content
          data-slot="console-sheet" data-testid="console-sheet"
          data-detent={detent} data-shape={shape === "inset" ? "inset" : undefined} data-edge={edge}
          onCloseAutoFocus={onCloseAutoFocus}
          // A toast is not "outside" (see SheetContent): tapping its close
          // button closed this instead of the toast.
          onInteractOutside={event => {
            if ((event.target as Element | null)?.closest?.("[data-sonner-toaster]")) event.preventDefault();
          }}
          onClickCapture={swallow}
          style={{
            left: gap, right: gap,
            ...(fromBottom ? { bottom: keyboard ? keyboard + gap : gap } : { top: gap }),
            height: Math.max(shown, detents.medium),
            borderRadius: shape === "inset" ? SHEET_INSET_RADIUS : fromBottom ? "10px 10px 0 0" : "0 0 10px 10px",
            transform: slide ? `translateY(${fromBottom ? slide : -slide}px)` : undefined,
            transition: dragged === null ? `${SHEET_SETTLE}, transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)` : SHEET_RESHAPE,
            [fromBottom ? "paddingBottom" : "paddingTop"]: pad,
          }}
          className={cn(
            "fixed z-50 flex flex-col overflow-clip text-card-foreground outline-none",
            dragged !== null ? SHEET_DRAGGING : shape === "inset" ? GLASS_SHEET : "bg-card shadow-lg",
            "duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=open]:animate-in data-[state=closed]:animate-out",
            fromBottom
              ? "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom"
              : "data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top",
          )}
        >
          {fromBottom && grabber}
          <div className="shrink-0 touch-none" onPointerDown={startDrag}>{header}</div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          {!fromBottom && grabber}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
