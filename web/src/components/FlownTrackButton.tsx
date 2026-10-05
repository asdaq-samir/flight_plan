import { useState } from "react";
import { Route } from "lucide-react";
import { ListGroup, ListRow } from "./GroupedList";
import IconButton from "./IconButton";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useFlownTrack } from "../lib/map/flownTrack";

/**
 * Among the map's buttons while a flown track is on the chart (a saved
 * flight's debrief put it there): what the lines are, and Hide.
 */
export default function FlownTrackButton() {
  const track = useFlownTrack(s => s.track);
  const hide = useFlownTrack(s => s.hide);
  const [open, setOpen] = useState(false);
  if (!track) return null;
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <IconButton label="Flown track" className="text-tint" data-testid="flown-track-button">
          <Route strokeWidth={1.5} className="size-5" />
        </IconButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Flown track" className="w-80 p-3" align="end" side="left">
        <ListGroup footer="Shown over its own route. Red is outside the ACS: over 3 nm off the route, or over 200 ft off the altitude in the cruise.">
          <ListRow title={track.title} description="As flown, from its debrief" />
          <ListRow
            media={<span className="inline-block h-1 w-5 rounded-full bg-[#1d1d1f] ring-2 ring-white dark:bg-white dark:ring-black" />}
            title="Within the tolerances"
          />
          <ListRow media={<span className="inline-block h-1 w-5 rounded-full bg-[#d70015] ring-2 ring-white" />} title="Outside them" />
          <ListRow title="Hide the track" onClick={() => { setOpen(false); hide(); }} data-testid="flown-track-hide" />
        </ListGroup>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
