import IconButton from "./IconButton";
import { useStopsAlong } from "../lib/stopsAlong";

/** A fork beside a pump: food and fuel, the Stops' two most asked for. */
function StopsGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
      <path d="M3 2v7a3 3 0 0 0 6 0V2M6 2v20M15 22V4a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v18M15 10h5" />
    </svg>
  );
}

/**
 * The map's Stops button, under its other buttons in a glass circle of its
 * own, at the owner's pick (option C of the stops canvas, "Try C",
 * 2026-10-23): while there is a route to look along, a tap opens the Stops
 * card -- the fields along the route with fuel, food or a place to rest,
 * to add as stops -- and a second tap puts it away.
 */
export default function StopsAlongButton() {
  const available = useStopsAlong(s => s.available);
  const open = useStopsAlong(s => s.open);
  const setOpen = useStopsAlong(s => s.setOpen);
  const opener = useStopsAlong(s => s.opener);
  if (!available) return null;
  return (
    <IconButton
      label={open ? "Hide the stops along the route" : "Stops along the route"} onClick={() => (open ? setOpen(false) : (opener ?? (() => setOpen(true)))())}
      aria-pressed={open} data-testid="stops-along-button"
    >
      <StopsGlyph />
    </IconButton>
  );
}
