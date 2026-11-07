import { useContext, useState } from "react";
import { Check, Copy, MapPinPlus } from "lucide-react";
import { CardCloseContext } from "./cardClose";
import { cn } from "cn";
import { CardAction } from "../../components/CardAction";
import DirectToIcon from "../../components/DirectToIcon";
import { usePointActions, type ChartPoint } from "./pointActions";

/**
 * A point card's actions, as an airport card's: Direct To, from where the
 * airplane is to the point and on along the route, and Add to Route, the
 * point a stop where it fits -- each while there is a route to do it to
 * (usePointActions) -- and Copy, the VOR's frequency for the radio.
 */
export function PointActions({ point, copy, addTestId = "point-add" }: {
  point: ChartPoint; copy: { label: string; text: string } | null;
  /** Its Add to Route's test id where a spec had one before (a VFR waypoint's). */
  addTestId?: string;
}) {
  const close = useContext(CardCloseContext);
  const { addToRoute, directTo } = usePointActions();
  const [copied, setCopied] = useState(false);
  if (!addToRoute && !directTo && !copy) return null;
  const done = (act: (p: ChartPoint) => void) => () => { close(); act({ ident: point.ident, lat: point.lat, lon: point.lon }); };
  return (
    // As many columns as tiles, as the airport card's row fills its width.
    <div className={cn("grid gap-2", [directTo, addToRoute, copy].filter(Boolean).length === 3 ? "grid-cols-3" : "grid-cols-2")} data-testid="point-actions">
      {directTo && <CardAction icon={<DirectToIcon />} label="Direct To" filled onClick={done(directTo)} testId="point-direct-to" />}
      {addToRoute && <CardAction icon={<MapPinPlus />} label="Add to Route" onClick={done(addToRoute)} testId={addTestId} />}
      {copy && (
        <CardAction
          icon={copied ? <Check /> : <Copy />} label={copied ? "Copied" : copy.label} spoken={`Copy ${copy.label}`}
          onClick={() => {
            // Called in the tap, as the clipboard asks; refused, nothing said.
            void navigator.clipboard?.writeText(copy.text).then(() => setCopied(true), () => {});
          }}
          testId="point-copy"
        />
      )}
    </div>
  );
}
