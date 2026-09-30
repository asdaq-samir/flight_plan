import { Settings } from "lucide-react";
import IconButton from "./IconButton";
import SettingsPanel, { type PageSettings } from "./SettingsPanel";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useNavEdge } from "../hooks/use-nav-edge";

/**
 * The header's settings, right of the console button on both pages
 * (SettingsPanel: the map, the checkpoints, own ship on the planner,
 * appearance, dev mode). On a phone a sheet from the header's edge with
 * a Done at its top (ResponsivePopover); from `md` up a popover under
 * the button, or over it with the header at the bottom, its end at the
 * button's.
 */
export default function SettingsButton({ page }: { page?: PageSettings }) {
  const edge = useNavEdge();
  return (
    <ResponsivePopover>
      <ResponsivePopoverTrigger asChild>
        <IconButton label="Settings" data-testid="settings-button">
          <Settings className="size-5" />
        </IconButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Settings" done side={edge === "top" ? "bottom" : "top"} align="end" className="w-96 p-3">
        <SettingsPanel page={page} />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
