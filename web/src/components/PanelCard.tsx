import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
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
  return (
    <div
      ref={card}
      className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-[var(--corner-inset,0.75rem)] pb-[max(1rem,env(safe-area-inset-bottom))] [scrollbar-width:none] print:hidden"
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
  line: ReactNode;
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
        <p className={cn("text-muted-foreground", TEXT.note, lineClassName)} data-testid={lineTestId}>{line}</p>
      </div>
      {children}
      <CloseButton onClick={onClose} className="-mr-1" data-testid={closeTestId} />
    </div>
  );
}
