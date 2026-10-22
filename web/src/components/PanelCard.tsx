import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import { FitText } from "./FitText";
import { closeTopCard, holdOpenCard, type CardShare } from "../lib/openCards";
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
  // There at once as it opens, still while the sheet moves round it, as a
  // tab's own page is (TabPage), at the owner's ask ("Is the airport and
  // aircraft card same style? Can it be common to other sheets where
  // sheet/content is not moving when viewed?"): it came in faded and up
  // into its place over half a second, an airport's, where an airplane's,
  // a TabPage, was there at once.
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
export function CardHead({ name, line, nameTestId, lineClassName, lineTestId, onClose, onShare, closeTestId, children }: {
  name: ReactNode;
  /** Under the name; none where the caller sets it out itself (an
   *  airport's card, beside its diagram's thumbnail). */
  line?: ReactNode;
  nameTestId?: string;
  lineClassName?: string;
  lineTestId?: string;
  onClose: () => void;
  /** Its share, for the bar's (CardClose). */
  onShare?: CardShare;
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
      <CardClose onClose={onClose} onShare={onShare} testId={closeTestId} className="-mr-1" />
    </div>
  );
}

/**
 * A card's top, the airport card's (PlaceCard), which the airplane's
 * (FlightCard) is laid out as too, at the owner's ask ("Do airport and
 * aircraft cards have same layouts?"; the airplane's buttons sat 6 points
 * lower and its tabs 12 further under them, and its name was cut where its
 * thumbnail began): three columns -- the name, the lines under it, a
 * picture beside them (an airport's runways, an airplane's trace), and at
 * the right the close, the star and a chip one over another -- and the
 * actions under them, all one height at every size, so the card keeps its
 * layout whatever it shows. A long name is set smaller to fit its column
 * (FitText) rather than pushing the actions down.
 */
export function CardTop({ name, nameTestId, nameFitTestId, lines, picture, side, actions, columns, tall = false, children }: {
  name: ReactNode;
  nameTestId: string;
  nameFitTestId?: string;
  /** Under the name, a note's grey. */
  lines?: ReactNode;
  /** Beside the name, its own box (min-w-0 flex-1). */
  picture: ReactNode;
  /** The right's column: the close, the star, a chip. */
  side: ReactNode;
  actions: ReactNode;
  /** The actions' columns. */
  columns: 3 | 4;
  /** A head a line taller, for a column of three round buttons (the
   *  airplane card's star, Follow and Share), which at the airport card's
   *  height met the actions under them. */
  tall?: boolean;
  /** In the top's row besides, out of its flow: a full-screen viewer. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col", tall ? "h-[11.5rem]" : "h-[10.5rem]")} data-to-edge="">
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <h2
            tabIndex={-1} data-testid={nameTestId}
            className={cn("min-h-0 flex-1 font-bold tracking-tight break-words text-foreground outline-none", TEXT.card)}
          >
            {/* From iOS's Title 1, 28 on 34, where the name fits its box at
                that, as Maps sets a place's. */}
            <FitText className="h-full text-[1.75rem] leading-[2.125rem]" data-testid={nameFitTestId}>{name}</FitText>
          </h2>
          {lines}
        </div>
        {picture}
        {/* Eight apart, so the buttons' 44-point hit areas (index.css) meet. */}
        <div className="-mr-1 flex w-9 shrink-0 flex-col items-center gap-2">{side}</div>
        {children}
      </div>
      <div className={cn("mt-1.5 grid gap-2", columns === 4 ? "grid-cols-4" : "grid-cols-3")}>{actions}</div>
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
export function CardClose({ onClose, onShare, testId }: {
  onClose: () => void;
  /** The card's share (an airport's, an airplane's, or the route's menu
   *  for the Brief, the nav log and the profile, each its own): the
   *  minimized tab bar's Share where its Back was (TabBar). */
  onShare?: CardShare;
  testId: string;
  className?: string;
}) {
  const close = useRef(onClose);
  const share = useRef(onShare);
  useEffect(() => { close.current = onClose; share.current = onShare; });
  const shares = typeof onShare === "string" ? onShare : !!onShare;
  useEffect(() => holdOpenCard({
    close: () => close.current(),
    share: typeof shares === "string" ? shares : shares ? () => { if (typeof share.current === "function") share.current(); } : undefined,
  }), [shares]);
  return (
    <span className="sr-only focus-within:not-sr-only">
      {/* Back one: a page opened in the card first (the Brief's), else the
          card (lib/openCards), as the bar's close goes. */}
      <CloseButton onClick={() => { if (!closeTopCard()) onClose(); }} data-testid={testId} />
    </span>
  );
}
