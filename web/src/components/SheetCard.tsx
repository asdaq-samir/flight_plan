import { isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import TabKept from "./TabKept";
import { Dialog, DialogPortal } from "./ui/dialog";
import { holdOpenCard } from "../lib/openCards";
import { SheetCardHead, useSheetCards } from "../lib/sheetCards";
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
  // The tab bar names it and has its close (TabBar, minimized): its own
  // row keeps only a form's Cancel and Save, its name there for a screen
  // reader and the focus.
  const barNamed = useSheetCards(s => s.barNamed) && title !== undefined;
  const card = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // A close of the caller's own in the head (`action`, the app's
  // CloseButton): one that goes back a page first, the procedures'. With
  // the tab bar naming the card it is the bar's close that does it, and
  // the card draws no second one (the owner's screenshot, 2026-10-27: two
  // closes over the arrivals).
  const back = isValidElement<{ onClick?: () => void }>(action) && action.type === CloseButton ? action.props.onClick : undefined;
  // The caller's latest, for what is set up once as it opens.
  const latest = useRef({ onClose, back });
  useEffect(() => { latest.current = { onClose, back }; });

  // Open while it is drawn: on the panel's stack (the panel up for it, the
  // tab bar's name), and the top of what the bar's close, a swipe back and
  // a device's Back take away (lib/openCards), as every card's close is.
  useEffect(() => {
    const close = () => latest.current.onClose();
    useSheetCards.setState(s => ({ stack: [...s.stack, { id, raise, close }] }));
    // Back one: a page of the card's first where it has one (`back`).
    const release = holdOpenCard({ close: () => (latest.current.back ?? latest.current.onClose)() });
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

  if (!host) return null;
  const end = (closeButton ?? (action === undefined && !leading))
    ? (barNamed ? null : <CloseButton onClick={onClose} data-testid="sheet-card-close" />)
    : barNamed && back ? null : action;
  return (
    // Radix's dialog, not modal: Escape and a tap on the chart put it away,
    // its focus in and out, and nothing else on the page put out of reach
    // -- no trap, nothing hidden from VoiceOver, the map live under it.
    // Open while it is drawn; the caller puts it away by drawing it no more.
    <Dialog open modal={false} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogPortal container={host}>
    {/* Under one opened over it, kept as it was and out of sight, for the
        close to come back to, as a tab is kept (TabKept). */}
    <TabKept away={!top}>
    {/* A labelled region, as Setup's layer is, not a dialog: nothing else
        on the page is put out of reach while it is open. A card's own
        scroller as PanelCard's is: from the panel's corner (its close
        where every card's is), on up under the panel's head, no scroll
        bar, as iOS shows none. */}
    <DialogPrimitive.Content asChild role="region" aria-labelledby={headingId} aria-describedby={undefined}
      // The focus to its name as it opens, which a screen reader then reads
      // -- after the frame, its name drawn in the head by then where the
      // content draws it -- unless the caller takes it (a search's field).
      onOpenAutoFocus={event => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        requestAnimationFrame(() => card.current?.querySelector<HTMLElement>(`[id="${headingId}"]`)?.focus({ preventScroll: true }));
      }}
      // And back to what opened it as it is put away, once what it covered
      // is back (the control may have been under it), unless the focus has
      // gone somewhere of its own since.
      onCloseAutoFocus={event => {
        onCloseAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        const opener = returnFocus?.();
        const at = document.activeElement;
        if (opener?.isConnected && (!at || at === document.body || !at.isConnected)) opener.focus({ preventScroll: true });
      }}
      // Escape puts the top one away, Radix's only to the top layer, ahead
      // of the panel's own Escape (which lowers it) as the default is then
      // prevented: back a page of the card's first where it has one. A
      // menu open in it is a layer over it and closes first.
      onEscapeKeyDown={event => {
        onEscapeKeyDown?.(event);
        if (event.defaultPrevented || !back) return;
        event.preventDefault();
        back();
      }}
      // A tap on the chart puts them away, as a tap outside the sheets
      // they were put away, and as Leaflet's own popup's is -- what the tap
      // opens is what shows, where it opened under them out of sight. Not
      // the map's own buttons, nor the panel, its tab bar or anything else
      // on the page. Radix waits for the click, so a pan or a pinch, no
      // tap, leaves them.
      onPointerDownOutside={event => {
        const at = event.target instanceof Element ? event.target : null;
        if (!at?.closest(".leaflet-container") || at.closest("[data-map-controls], .leaflet-control")) event.preventDefault();
      }}
      // The focus going elsewhere -- the panel, the map -- leaves it open:
      // the card is no modal.
      onFocusOutside={event => event.preventDefault()}
    >
    <section
      ref={card} data-testid={testId} data-sheet-card=""
      className="under-head relative min-h-0 flex-1 overflow-y-auto px-4 [--under-pad:var(--corner-inset,0.75rem)] pb-[max(1rem,env(safe-area-inset-bottom))] [scrollbar-width:none]"
    >
      {/* Its name at the left at a card's size and the close at the right
          end of its row, as CardHead sets a place's; a form's Cancel and
          Save at the two ends, the name between them. */}
      <div className={cn("flex shrink-0 items-center gap-2 pb-3", (titleHidden || (barNamed && end == null && !leading)) && "sr-only")}>
        {leading}
        {title === undefined ? (
          <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-2.5" />
        ) : (
          <div className={cn("min-w-0 flex-1", leading && "text-center", barNamed && "[&>*]:sr-only")}>
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
    </DialogPrimitive.Content>
    </TabKept>
    </DialogPortal>
    </Dialog>
  );
}
