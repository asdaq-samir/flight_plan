import type { ReactNode } from "react";
import { cn } from "cn";

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
 * There is no close button at all now: a tap on the chart puts a card
 * away, which is what every map does and what Leaflet's `closeOnClick`
 * already did for two of the three. `MapShell` fits the route when the
 * last card closes, so the tap that opened a card and the tap that puts
 * it away are both halves of one gesture. A card's own controls -- the
 * terminal chart's pin, the training pass's step arrows -- sit in the
 * head, which is what `leading` and `actions` are for.
 */
export function MapCard({
  title, subtitle, actions, leading, className, children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** This card's own corner controls, drawn left of the close. */
  actions?: ReactNode;
  /** A control that belongs with the title rather than in the corner,
   *  drawn at the head's left edge -- the Class B card's terminal-chart
   *  pin, which is about the field the title names. */
  leading?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    // whitespace-normal: Leaflet's stylesheet sets `white-space: nowrap`
    // on every tooltip, which is right for a one-line course label and
    // wrong here -- a raw METAR ran straight off the card's right edge.
    // It inherits, so setting it on this root is enough.
    <div className={cn("space-y-1.5 text-xs whitespace-normal", className)}>
      <div className="flex items-start gap-2">
        {leading}
        {/* Centred, and `flex justify-center` rather than `text-center`
            so a title that is itself a row -- an ident beside its
            flight-category chip -- centres as a block too. It centres
            in the space the corner controls leave, not in the card:
            those are part of the head, and a title that ignored them
            would sit under the close on a narrow card. */}
        <div className="min-w-0 flex-1 space-y-0.5 text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold">{title}</div>
          {subtitle !== undefined && <div className="text-muted-foreground">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
