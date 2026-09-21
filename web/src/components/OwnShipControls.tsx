import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { ownShip, ownShipAvailable, useOwnShip } from "../lib/map/ownShip";

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
}

/**
 * The own-ship switches in the map's info popover: show the phone's
 * position on the chart, and keep the map centred on it. A line under
 * them says what the GPS has -- position, accuracy, ground speed and
 * heading -- or why there is nothing: no secure connection (the
 * browser grants geolocation only to https or localhost), or access
 * refused. Following ends when the pilot pans the map themselves
 * (RouteMap turns it off on a drag) and comes back with the checkbox.
 */
export default function OwnShipControls() {
  const { enabled, follow, fix, error } = useOwnShip();
  const available = ownShipAvailable();
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Position</div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="own-ship"
          checked={enabled}
          disabled={!available}
          onCheckedChange={value => ownShip.setEnabled(value === true)}
          data-testid="own-ship-toggle"
        />
        <Label htmlFor="own-ship" className="font-normal">Show my position</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="own-ship-follow"
          checked={follow}
          disabled={!available || !enabled}
          onCheckedChange={value => ownShip.setFollow(value === true)}
          data-testid="own-ship-follow"
        />
        <Label htmlFor="own-ship-follow" className="font-normal">Keep the map on me</Label>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="own-ship-status">
        {!available
          ? "Needs a secure connection: open this app over https (or on this machine as localhost)."
          : error ?? (!enabled
            ? "From the phone's GPS, drawn as a blue arrow on the chart."
            : !fix
              ? "Waiting for a position…"
              : `${coordinate(fix.lat, "N", "S")} ${coordinate(fix.lon, "E", "W")} · ±${Math.round(fix.accuracyM)} m`
                + (fix.speedKt !== null ? ` · ${Math.round(fix.speedKt)} kt` : "")
                + (fix.headingDeg !== null ? ` · ${String(Math.round(fix.headingDeg)).padStart(3, "0")}°` : ""))}
      </p>
    </div>
  );
}
