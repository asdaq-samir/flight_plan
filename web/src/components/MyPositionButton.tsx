import { useEffect } from "react";
import { Navigation } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import IconButton from "./IconButton";
import { ownShipAvailable, useOwnShip } from "../lib/map/ownShip";

/**
 * My position, among the map's buttons, as Maps and every map app has
 * it: the location arrow. A tap shows where the phone is and keeps the
 * map on it; once the map is panned away (OwnShipLayer stops following)
 * a tap brings it back; a tap while it is following puts the position
 * away. The arrow is filled while the map follows, hollow otherwise,
 * and pulses while the GPS has nothing yet. It was two switches at the
 * foot of the settings, Show my position and Keep the map on me, with
 * the coordinates under them.
 *
 * Over plain http the browser keeps the position from the page (only a
 * secure origin gets geolocation), and a tap says so; a refusal of the
 * browser's own prompt is said once, as it happens.
 */
export default function MyPositionButton() {
  const enabled = useOwnShip(s => s.enabled);
  const follow = useOwnShip(s => s.follow);
  const fix = useOwnShip(s => s.fix);
  const error = useOwnShip(s => s.error);
  const setEnabled = useOwnShip(s => s.setEnabled);
  const setFollow = useOwnShip(s => s.setFollow);
  useEffect(() => {
    if (error) toast.error("No position", { id: "own-ship", description: error });
  }, [error]);
  const following = enabled && follow;
  const tap = () => {
    if (!ownShipAvailable()) {
      toast.error("No position over this connection", {
        id: "own-ship", description: "The browser gives a page the phone's position only over https.",
      });
    } else if (!enabled) {
      setFollow(true);
      setEnabled(true);
    } else if (!follow) {
      setFollow(true);
    } else {
      setEnabled(false);
    }
  };
  return (
    <IconButton
      label={!enabled ? "Show my position" : follow ? "Hide my position" : "Follow my position"}
      onClick={tap} aria-pressed={enabled} data-testid="my-position-button"
      className="text-tint"
    >
      <Navigation className={cn("size-5", following && "fill-current", enabled && !fix && "animate-pulse")} />
    </IconButton>
  );
}
