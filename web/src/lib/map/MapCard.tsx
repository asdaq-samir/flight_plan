import { useContext, type ReactNode } from "react";
import { X } from "lucide-react";
import { useMap } from "react-leaflet";
import { cn } from "cn";
import IconButton from "../../components/IconButton";
import { FitRoute } from "./fitRoute";

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
 * So the close is the app's own button, at one size, in one place, and
 * `MapPopup` turns Leaflet's off. A card's own controls sit beside it
 * at that same size, which is what `actions` is for. The training
 * card's step arrows stay bigger on purpose: they are how a rating pass
 * moves from point to point on a touchscreen, not corner chrome.
 */
export function MapCard({
  title, subtitle, actions, onClose, closable, className, children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** This card's own corner controls, drawn left of the close. */
  actions?: ReactNode;
  /** For a card whose open state is React's, not Leaflet's -- the
   *  training map's, which follows the selection the keys walk. */
  onClose?: () => void;
  /** For a card Leaflet opened: closes it the way its own X did. */
  closable?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const map = useMap();
  const fitRoute = useContext(FitRoute);
  // Closing a card puts the map back where it was before the tap that
  // opened it: a tap on a marker goes to it, so its close comes back
  // out to the whole route. Both halves of one gesture, and because it
  // lives here it is true of every card rather than of whichever ones
  // remembered. Leaflet closing a card on its own -- opening the next
  // one -- does not come through here, so stepping between markers does
  // not fit the route between each pair.
  const close = () => {
    if (onClose) onClose();
    else map.closePopup();
    fitRoute?.();
  };
  return (
    // whitespace-normal: Leaflet's stylesheet sets `white-space: nowrap`
    // on every tooltip, which is right for a one-line course label and
    // wrong here -- a raw METAR ran straight off the card's right edge.
    // It inherits, so setting it on this root is enough.
    <div className={cn("space-y-1.5 text-xs whitespace-normal", className)}>
      <div className="flex items-start gap-2">
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
        {/* The toast's shape -- sonner draws its close as a small
            bordered circle -- on the app's own stock icon button, which
            is the same Button + lucide X + accessible name that
            shadcn's own Sheet close is made of. Circular also puts it
            in a family with the training card's step arrows. Kept at
            32px rather than sonner's 20: a toast close is aimed with a
            mouse, this one with a thumb over a moving chart. */}
        {(closable || onClose) && (
          <IconButton
            type="button" label="Close" size="icon-sm" variant="outline"
            className="shrink-0 rounded-full" onClick={close} data-testid="popup-close"
          >
            <X className="size-4" />
          </IconButton>
        )}
      </div>
      {children}
    </div>
  );
}
