import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import { holdOpenCard } from "../lib/openCards";
import { TEXT } from "../lib/text";

/**
 * A card in the map's panel, as a place's is in Maps -- an airport's
 * (PlaceCard), the airspace over a point (AirspaceCard), the fields
 * nearest the pilot (NearestCard): its head at the top and its sections
 * under it, scrolling. Its top is the panel's corner's (MapPanel's
 * --corner-inset), so its close is where every panel's top-right button
 * is, at the pilot's ask; no scroll bar, as iOS shows none, to move that
 * in from the side.
 */
export function PanelCard({ testId, children }: { testId: string; children: ReactNode }) {
  // Opened from a marker on the chart with the keys (Enter on it), the
  // focus goes to the card's name, which a screen reader then reads, and
  // back to the marker as the card is put away -- where it stayed on the
  // marker, the card a page away in the tab order and said by nothing.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    const node = card.current;
    if (!node || !from?.closest(".leaflet-container")) return;
    node.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    return () => {
      const at = document.activeElement;
      if (from.isConnected && (!at || at === document.body || node.contains(at))) from.focus({ preventScroll: true });
    };
  }, []);
  // In as Maps' place card comes in: faded and up into its place as the
  // sheet rises for it, on the sheet's own curve and time (mapChrome's
  // SHEET_CURVE, half a second) so the two arrive together, and again for
  // the next card opened over it (a card is keyed by what it shows) --
  // where it was there at once, the last tab's contents swapped for it in
  // one frame (traced 2026-10-14). A third of a second on its own easing
  // read too fast and not smooth, the owner found on the phone. With
  // Reduce Motion, the fade alone.
  return (
    <div
      ref={card}
      className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-[var(--corner-inset,0.75rem)] pb-[max(1rem,env(safe-area-inset-bottom))] [scrollbar-width:none] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] animate-in fade-in slide-in-from-bottom-6 motion-reduce:slide-in-from-bottom-0 print:hidden"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/**
 * A card's head: its name, the line under it in a note's grey (what it
 * is, not text to read, as the line under a place's name is in Maps),
 * what goes beside them (an airport's weather and its star), and the
 * close, out to the head's row's inset (px-3) as the route's close is.
 */
export function CardHead({ name, line, nameTestId, lineClassName, lineTestId, onClose, closeTestId, children }: {
  name: ReactNode;
  /** Under the name; none where the caller sets it out itself (an
   *  airport's card, beside its diagram's thumbnail). */
  line?: ReactNode;
  nameTestId?: string;
  lineClassName?: string;
  lineTestId?: string;
  onClose: () => void;
  closeTestId: string;
  /** Between the name and the close. */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h2 tabIndex={-1} className={cn("font-bold tracking-tight text-foreground outline-none", TEXT.card)} data-testid={nameTestId}>{name}</h2>
        {line != null && <p className={cn("text-muted-foreground", TEXT.note, lineClassName)} data-testid={lineTestId}>{line}</p>}
      </div>
      {children}
      <CardClose onClose={onClose} testId={closeTestId} className="-mr-1" />
    </div>
  );
}

/**
 * A card's close, kept for a device's Back (lib/openCards, lib/back) and
 * the minimized tab bar's Back (TabBar) while the card is open -- and never
 * drawn, at the owner's ask: "Close should not be anywhere except the top
 * right corner of the card inline with label; when tabs labels appear,
 * both close and back button hide" (the tab bar's own, TabBar). Kept for
 * a keyboard and a screen reader, shown when it has the focus, as a skip
 * link is, so a card always has a control of its own to reach (and the
 * airspace's, with no other, a stop in its scrolling region). With the
 * tabs shown, the tab up tapped again puts the card away.
 */
export function CardClose({ onClose, testId }: { onClose: () => void; testId: string; className?: string }) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => holdOpenCard({ close: () => close.current() }), []);
  return (
    <span className="sr-only focus-within:not-sr-only">
      <CloseButton onClick={onClose} data-testid={testId} />
    </span>
  );
}
