import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import TabKept from "./TabKept";
import { holdOpenCard } from "../lib/openCards";
import { closeSheetCards, SheetCardHead, useSheetCards } from "../lib/sheetCards";
import { TEXT } from "../lib/text";

/**
 * A card in the map's panel on a phone, opened from anywhere on the page:
 * a control's (ResponsivePopover's -- the Map settings, the approaches, an
 * airplane's form) or a thing tapped on the chart (MapPopup's -- a
 * checkpoint, a VFR waypoint, a TFR). Each was a sheet floating over the
 * panel, or a Leaflet popup over the chart, two more surfaces over the one
 * the pilot already had; at the owner's ask ("Yes to all, let's have
 * consistency and common code", 2026-10-27) they are cards in the panel,
 * as Maps opens a place's card in its one sheet.
 *
 * Drawn where the caller is, in React's tree, so what it reads from its
 * providers stays the same; put on the page in the panel's body
 * (SheetCardHost, MapPanel), over the tab or card that is there, which is
 * kept as it was for when this is put away. The last opened on top: one
 * opened from another (a hold from the procedures) covers it, and its
 * close goes back to it.
 */

/** Where the panel's body takes the cards: under the panel's head, the
 *  body's whole room, while one is open. */
export function SheetCardHost({ shown }: { shown: boolean }) {
  // A tap on the chart puts them away, as a tap outside the sheets they
  // were put away, and as Leaflet's own popup's is: what the tap opens --
  // an airport's card, another point's -- is what shows, where it opened
  // under them out of sight. Heard first (capture), so a card the tap
  // opens comes after; not the map's own buttons. A pan or a pinch is no
  // tap and leaves them.
  useEffect(() => {
    if (!shown) return;
    const tap = (event: MouseEvent) => {
      const at = event.target instanceof Element ? event.target : null;
      if (at?.closest(".leaflet-container") && !at.closest("[data-map-controls], .leaflet-control")) closeSheetCards();
    };
    document.addEventListener("click", tap, true);
    return () => document.removeEventListener("click", tap, true);
  }, [shown]);
  return <div ref={hostRef} data-sheet-cards="" className={shown ? "flex min-h-0 flex-1 flex-col print:hidden" : "hidden"} />;
}

/** One function, so React does not take the host away and put it back at
 *  each of the panel's renders, the cards in it with it. */
function hostRef(node: HTMLDivElement | null) {
  useSheetCards.setState({ host: node });
  return () => useSheetCards.setState(s => (s.host === node ? { host: null } : s));
}

export function SheetCard({
  title, titleHidden = false, description, leading, action, closeButton, onClose, raise = "half", testId, returnFocus,
  onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown, children,
}: {
  /** Its name, at a card's size at the head's left. None where the
   *  content draws it in the head itself (SheetCardHead). */
  title?: string;
  /** Named for a screen reader only: content that opens with its own
   *  field and close (the airport search's). */
  titleHidden?: boolean;
  /** Under the name, a note's grey. */
  description?: string;
  /** At the head's start: a form's Cancel, as an iOS sheet puts it, the
   *  name then between the two. */
  leading?: ReactNode;
  /** At the head's end in the close's place: a form's Save, a Done, a
   *  close of the caller's own that goes back a page first. */
  action?: ReactNode;
  /** The app's close at the head's end; by default where nothing else is
   *  there (`action`, `leading`). False where the content's own Done is
   *  the way out. */
  closeButton?: boolean;
  onClose: () => void;
  raise?: "half" | "full";
  testId?: string;
  /** Where the focus goes back to as it is put away: the control that
   *  opened it, where that is known. */
  returnFocus?: () => HTMLElement | null;
  /** As Radix's: prevented, the focus is left to the caller (a search's
   *  field takes it). */
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const id = useId();
  const headingId = `${id}-name`;
  const host = useSheetCards(s => s.host);
  const top = useSheetCards(s => s.stack.at(-1)?.id === id);
  const card = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // The caller's latest, for what is set up once as it opens.
  const latest = useRef({ onClose, returnFocus, onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown });
  useEffect(() => { latest.current = { onClose, returnFocus, onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown }; });

  // Open while it is drawn: on the panel's stack (the panel up for it, the
  // tab bar's name), and the top of what the bar's close, a swipe back and
  // a device's Back take away (lib/openCards), as every card's close is.
  useEffect(() => {
    const close = () => latest.current.onClose();
    useSheetCards.setState(s => ({ stack: [...s.stack, { id, raise, close }] }));
    const release = holdOpenCard({ close });
    return () => {
      release();
      useSheetCards.setState(s => ({ stack: s.stack.filter(entry => entry.id !== id) }));
    };
    // Its raise is what it opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    useSheetCards.setState(s => ({ stack: s.stack.map(entry => (entry.id === id && entry.title !== title ? { ...entry, title } : entry)) }));
  }, [id, title]);

  // The focus to its name as it opens, which a screen reader then reads --
  // after the frame, its name drawn in the head by then where the content
  // draws it -- and back to what opened it as it is put away, unless the
  // focus has gone somewhere of its own since.
  useEffect(() => {
    const opening = new Event("sheetCard.openAutoFocus", { cancelable: true });
    latest.current.onOpenAutoFocus?.(opening);
    const frame = requestAnimationFrame(() => {
      if (!opening.defaultPrevented) card.current?.querySelector<HTMLElement>(`[id="${headingId}"]`)?.focus({ preventScroll: true });
    });
    const handlers = latest.current;
    return () => {
      cancelAnimationFrame(frame);
      const closing = new Event("sheetCard.closeAutoFocus", { cancelable: true });
      handlers.onCloseAutoFocus?.(closing);
      if (closing.defaultPrevented) return;
      const opener = handlers.returnFocus?.();
      // Once what it covered is back: the control may have been under it.
      window.setTimeout(() => {
        const at = document.activeElement;
        if (opener?.isConnected && (!at || at === document.body || !at.isConnected)) opener.focus({ preventScroll: true });
      });
    };
  }, [headingId]);

  // Escape puts the top one away: heard on it first, ahead of the panel's
  // own Escape (which lowers it), and on the document for when a tap
  // elsewhere has taken the focus out -- the card is no modal. A menu open
  // in it has prevented the default by then, closing first.
  useEffect(() => {
    const node = card.current;
    if (!node || !top) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      latest.current.onEscapeKeyDown?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      latest.current.onClose();
    };
    node.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onKey);
    };
  }, [top, host]);

  if (!host) return null;
  const end = (closeButton ?? (action === undefined && !leading))
    ? <CloseButton onClick={onClose} data-testid="sheet-card-close" />
    : action;
  return createPortal(
    // Under one opened over it, kept as it was and out of sight, for the
    // close to come back to, as a tab is kept (TabKept).
    <TabKept away={!top}>
    {/* A labelled region, as Setup's layer is, not a dialog: nothing else
        on the page is put out of reach while it is open. A card's own
        scroller as PanelCard's is: from the panel's corner (its close
        where every card's is), on up under the panel's head, no scroll
        bar, as iOS shows none. */}
    <section
      ref={card} aria-labelledby={headingId} data-testid={testId} data-sheet-card=""
      className="under-head relative min-h-0 flex-1 overflow-y-auto px-4 [--under-pad:var(--corner-inset,0.75rem)] pb-[max(1rem,env(safe-area-inset-bottom))] [scrollbar-width:none]"
    >
      {/* Its name at the left at a card's size and the close at the right
          end of its row, as CardHead sets a place's; a form's Cancel and
          Save at the two ends, the name between them. */}
      <div className={cn("flex shrink-0 items-center gap-2 pb-3", titleHidden && "sr-only")}>
        {leading}
        {title === undefined ? (
          <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-2.5" />
        ) : (
          <div className={cn("min-w-0 flex-1", leading && "text-center")}>
            <h2 id={headingId} tabIndex={-1} className={cn("font-bold tracking-tight break-words text-foreground outline-none", TEXT.card)}>{title}</h2>
            {description && <p className={cn("text-muted-foreground", TEXT.note)}>{description}</p>}
          </div>
        )}
        {end != null && <div className="-mr-1 flex shrink-0 items-center">{end}</div>}
      </div>
      <SheetCardHead.Provider value={title === undefined ? { slot, headingId } : null}>
        {children}
      </SheetCardHead.Provider>
    </section>
    </TabKept>,
    host,
  );
}
