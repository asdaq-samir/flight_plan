import IconButton from "./IconButton";
import { useStopsAlong } from "../lib/stopsAlong";

/** A fork beside a knife: somewhere to eat. */
function StopsGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
      <path d="M3 2v7a3 3 0 0 0 6 0V2M6 2v20M15 22V4a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v18M15 10h5" />
    </svg>
  );
}

/**
 * The map's fly-in food button, under its other buttons in a glass circle
 * of its own: a tap opens the card of the fields near the pilot with
 * somewhere to eat a short walk from the ramp, the "$100 hamburger" (the
 * owner, 2026-10-25; it was the stops along the route), and a second tap
 * puts it away.
 */
export default function StopsAlongButton() {
  const available = useStopsAlong(s => s.available);
  const open = useStopsAlong(s => s.open);
  const setOpen = useStopsAlong(s => s.setOpen);
  const opener = useStopsAlong(s => s.opener);
  if (!available) return null;
  return (
    <IconButton
      label={open ? "Hide the food at the fields" : "Food at the fields near you"} onClick={() => (open ? setOpen(false) : (opener ?? (() => setOpen(true)))())}
      aria-pressed={open} data-testid="stops-along-button"
    >
      <StopsGlyph />
    </IconButton>
  );
}
