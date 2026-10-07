import { useState } from "react";
import { Map as MapIcon } from "lucide-react";
import IconButton from "./IconButton";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import MapSettings from "./MapSettings";

/**
 * The map's own button, first among the map's buttons as Maps' is: its
 * sheet the map's settings -- the chart, Class B's weather and terminal
 * sheet, the waypoints, the TFRs, keeping charts offline -- where Maps
 * keeps its map's, at the pilot's ask. It was Nearest's place; Nearest is
 * on the open route's head, where the console's button was.
 */
export default function MapSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <IconButton label="Map" className="text-foreground" data-testid="map-settings-button">
          <MapIcon strokeWidth={1.5} className="size-5" />
        </IconButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Map" className="w-96 max-w-[calc(100vw-2rem)] p-3" align="end" side="left" data-testid="map-settings">
        <MapSettings />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
