import { Play, Square } from "lucide-react";
import IconButton from "./IconButton";
import { useDryRunButton } from "../lib/dryRunButton";

/**
 * The map's Play, above Stops: the route's dry run, its airplane flown
 * along the course over the profile, which opens with it (the owner's
 * "No need for a separate profile button, just that would be the profile
 * demo button", 2026-10-27). Stop while it flies. Only with a route ready
 * to fly.
 */
export default function DryRunButton() {
  const ready = useDryRunButton(s => s.ready);
  const flying = useDryRunButton(s => s.flying);
  const play = useDryRunButton(s => s.play);
  const stop = useDryRunButton(s => s.stop);
  if (!ready && !flying) return null;
  return (
    <IconButton
      label={flying ? "Stop the dry run" : "Dry run: fly the route on its profile"}
      onClick={() => (flying ? stop?.() : play?.())}
      aria-pressed={flying} data-testid="dry-run-button"
    >
      {flying ? <Square className="size-4" strokeWidth={2} fill="currentColor" aria-hidden="true" /> : <Play className="size-5" strokeWidth={1.75} aria-hidden="true" />}
    </IconButton>
  );
}
