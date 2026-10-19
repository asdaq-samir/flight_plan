import { useEffect } from "react";
import { Navigation, Route } from "lucide-react";
import { showError } from "../lib/problems";
import { cn } from "cn";
import IconButton from "./IconButton";
import { APPROXIMATE_M, ownShipAvailable, useOwnShip } from "../lib/map/ownShip";

/**
 * My position, among the map's buttons, as Maps and every map app has
 * it: the location arrow. A tap shows where the phone is, flies the map
 * there closing in on it, and keeps the map on it; once the map is
 * panned away (OwnShipLayer stops following) a tap brings it back the
 * same way; a tap while it is following puts the position away. The
 * arrow is iOS's, drawn fine: filled while the map follows, an outline
 * otherwise, and pulsing while the GPS has nothing yet. It was two switches at the
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
  // Whether there is a fix, not the fix: drawn again once, not at each
  // second's new one in the air.
  const fixed = useOwnShip(s => s.fix !== null);
  const error = useOwnShip(s => s.error);
  const setEnabled = useOwnShip(s => s.setEnabled);
  const recentre = useOwnShip(s => s.recentre);
  useEffect(() => {
    // Said once, as it happens: a refusal of the browser's prompt.
    if (error) showError("No position", error);
  }, [error]);
  // Precise Location off: said once as the position comes in that way,
  // since everything drawn from it may be a mile or more out.
  const approximate = useOwnShip(s => s.fix !== null && s.fix.accuracyM >= APPROXIMATE_M);
  useEffect(() => {
    if (approximate) {
      showError("Approximate position",
        "Precise Location is off for Wingtip Maps, so your position, the glide ring and what is ahead may be a mile or more out. Turn it on in the phone's Settings, under Privacy and Location Services.");
    }
  }, [approximate]);
  const following = enabled && follow;
  // In a dry run, with the airplane in the middle, the arrow's other
  // face: the whole route, at the owner's ask ("Can the locator button
  // change to fit line during dry run when plane is centered on the
  // screen"). Tapped, the map fits the route and the arrow comes back,
  // to bring the map back in on the airplane (OwnShipLayer, DRY_RUN_ZOOM).
  const simulated = useOwnShip(s => s.simulated);
  const showRoute = useOwnShip(s => s.showRoute);
  // And with a route entered and the map panned or zoomed off it, own
  // ship not followed, at the owner's ask ("When the route is entered,
  // and map is panned away from the route, have the locator icon change
  // to fit the course"): tapped, the course fitted again, and the arrow
  // back to go to the position from there.
  const routeAway = useOwnShip(s => s.routeOutOfView);
  const routeFace = (simulated && following) || (routeAway && !following);
  const tap = () => {
    if (routeFace) {
      showRoute();
    } else if (!ownShipAvailable()) {
      showError("No position over this connection", "The browser gives a page the phone's position only over https.");
    } else if (!enabled) {
      setEnabled(true);
      recentre();
    } else if (!follow) {
      recentre();
    } else {
      setEnabled(false);
    }
  };
  return (
    <IconButton
      label={routeFace ? "Show the whole route" : simulated ? "Follow the airplane" : !enabled ? "Show my position" : follow ? "Hide my position" : "Follow my position"}
      onClick={tap} aria-pressed={routeFace ? undefined : enabled} data-testid="my-position-button" data-face={routeFace ? "route" : "position"}
      className="text-tint"
    >
      {/* Fine and sharp-cornered, as iOS's own arrow is: lucide's is
          drawn with round joins at 2, a heavier mark than any around it. */}
      {routeFace ? <Route strokeWidth={1.5} className="size-5" /> : (
        <Navigation
          strokeWidth={1.5} strokeLinejoin="miter"
          className={cn("size-5", following && "fill-current", enabled && !fixed && "animate-pulse")}
        />
      )}
    </IconButton>
  );
}
