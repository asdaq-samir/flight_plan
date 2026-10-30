import { useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import type { PillHead } from "../openCards";
import { SheetCardHead } from "../sheetCards";
import { TEXT } from "../text";

/**
 * What every card on either map is made of: what the thing is, where it
 * is, and whatever that particular card can do about it, in one corner.
 *
 * Measured before this existed, across the three cards a pilot can
 * open: two different close buttons -- Leaflet's own 24x24 glyph jammed
 * into the very corner on two of them, the app's 32x32 button inset by
 * 14 and 25 on the third -- and three sizes of corner control (32, 36
 * and 40). Each was reasonable where it was written and none of them
 * agreed.
 *
 * One size, too: see the width below. Its words at a list's sizes
 * (TEXT): to a finger the title 17 points and the rest 15, where they
 * were 14 and 12.
 *
 * There is no close button on the chart's: a tap on the chart puts a card
 * away, which is what every map does and what Leaflet's `closeOnClick`
 * already did for two of the three. `MapShell` fits the route when the
 * last card closes, so the tap that opened a card and the tap that puts
 * it away are both halves of one gesture. A card's own controls -- the
 * terminal chart's pin, the training pass's step arrows -- sit in the
 * head, which is what `leading` is for. On a phone it is a card in the
 * map's panel instead (MapPopup), with the panel's close as every card's.
 */
export function MapCard({ title, subtitle, leading, media, pill, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A control that belongs with the title rather than in the corner,
   *  drawn at the head's left edge -- the Class B card's terminal-chart
   *  pin, which is about the field the title names. */
  leading?: ReactNode;
  /** The thing's own mark before its title -- a checkpoint's numbered
   *  dot, a waypoint's diamond, a TFR's badge -- the head then set to its
   *  left, as a list's rows are: the cards on the map read as the
   *  panel's do, at the pilot's ask for every card to read as Nearest's. */
  media?: ReactNode;
  /** What the pill shows of it on a phone, as an airport's card's head
   *  drawn small (PillPicture): its name, one line, and its colour on the
   *  chart behind them, at the owner's ask (2026-10-29). */
  pill?: PillHead;
  children?: ReactNode;
}) {
  // On a phone, a card in the map's panel (MapPopup's SheetCard): its mark
  // and its name in the card's head, at a card's size where its close is,
  // and the rest the card's body, the panel's width.
  const inSheet = useContext(SheetCardHead);
  // Given by its strings, not the object, made new at each draw.
  const setPill = inSheet?.setPill;
  const name = pill?.name, line = pill?.line, colour = pill?.colour;
  useEffect(() => {
    if (!setPill || !name) return;
    setPill({ name, line, colour });
    return () => setPill(undefined);
  }, [setPill, name, line, colour]);
  if (inSheet) {
    return (
      <>
        {inSheet.slot && createPortal(
          <>
            {leading}
            {media}
            <div className="min-w-0 flex-1">
              <h2 id={inSheet.headingId} tabIndex={-1} className={cn("flex flex-wrap items-center gap-x-2 font-bold tracking-tight text-foreground outline-none", TEXT.card)}>{title}</h2>
              {subtitle !== undefined && <p className={cn("text-muted-foreground", TEXT.detail)}>{subtitle}</p>}
            </div>
          </>,
          inSheet.slot,
        )}
        <div className={cn("space-y-1.5", TEXT.detail)}>{children}</div>
      </>
    );
  }
  return (
    // whitespace-normal: Leaflet's stylesheet sets `white-space: nowrap`
    // on every tooltip, which is right for a one-line course label and
    // wrong here -- a raw METAR ran straight off the card's right edge.
    // It inherits, so setting it on this root is enough.
    // As wide as its own content, up to a cap, and never narrower than
    // whatever it is sitting in. All three parts earn their place:
    //
    // `w-max` is the content's own preferred width, so a card carrying
    // an ident and an airport name is that wide and one carrying a raw
    // METAR runs to the cap and wraps inside it. Needed because a
    // Leaflet *tooltip* shrink-wraps its content: with `white-space`
    // normal and no preferred width to measure, the Class B card
    // collapsed into a narrow column and wrapped the METAR every four
    // words.
    //
    // `min-w-full` is for the other case. A Leaflet *popup* sizes its
    // own content box and writes a width onto it, never below its
    // `minWidth` -- so a short card measured 89px inside a 221px box
    // and sat against its left edge, with 15px of space on one side and
    // 147px on the other. Filling the box puts that right. In a tooltip
    // the parent shrink-wraps, so this resolves to nothing and `w-max`
    // still governs.
    <div className={cn("w-max min-w-full max-w-[min(22rem,74vw)] space-y-1.5 whitespace-normal", TEXT.detail)}>
      <div className={cn("flex gap-2", media ? "items-center gap-2.5" : "items-start")}>
        {leading}
        {media}
        {/* Beside its mark, set to the left as a row is; with none,
            centred, and `flex justify-center` rather than `text-center`
            so a title that is itself a row -- an ident beside its
            flight-category chip -- centres as a block too. It centres
            in the space the corner controls leave, not in the card:
            those are part of the head, and a title that ignored them
            would sit under the close on a narrow card. */}
        <div className={cn("min-w-0 flex-1 space-y-0.5", media ? "text-left" : "text-center")}>
          <div className={cn("flex items-center gap-2 font-semibold", media ? "justify-start" : "justify-center", TEXT.row)}>{title}</div>
          {subtitle !== undefined && <div className="text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
