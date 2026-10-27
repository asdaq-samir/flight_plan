import { MapPin } from "lucide-react";
import IconButton from "./IconButton";
import { useStopsAlong } from "../lib/stopsAlong";

/**
 * The map's Stops button, under its other buttons in a glass circle of its
 * own, where Fly-in Food's fork and knife was, now a map pin (the owner's
 * pick of the Stops canvas, I, 2026-10-27): a tap opens the Stops sheet
 * -- the fields with fuel, food, repair or flight training round the
 * pilot or along the route (StopsCard) -- and a second tap puts it away.
 */
export default function StopsAlongButton() {
  const available = useStopsAlong(s => s.available);
  const open = useStopsAlong(s => s.open);
  const setOpen = useStopsAlong(s => s.setOpen);
  const opener = useStopsAlong(s => s.opener);
  if (!available) return null;
  return (
    <IconButton
      label={open ? "Hide the stops" : "Stops: fuel, food, repair and training at the airports"}
      onClick={() => (open ? setOpen(false) : (opener ?? (() => setOpen(true)))())}
      aria-pressed={open} data-testid="stops-along-button"
    >
      <MapPin className="size-5" strokeWidth={1.5} aria-hidden="true" />
    </IconButton>
  );
}
