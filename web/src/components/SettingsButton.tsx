import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import ChartLayers from "./ChartLayers";
import DevSwitch from "./DevSwitch";
import IconButton from "./IconButton";
import NavBarSetting from "./NavBarSetting";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useNavEdge } from "../hooks/use-nav-edge";

/**
 * The header's settings, right of the console button on both pages: the
 * navigation bar's edge, dev mode (for whoever it is for), the chart
 * layers, and what the page adds of its own (`children`: the planner's
 * every-landmark switch and own ship). A gear in the header since the
 * map's layers button, which held the chart layers alone, became it.
 *
 * On a phone a sheet from the header's edge (ResponsivePopover); from
 * `md` up a popover under the button, or over it with the header at the
 * bottom, its end at the button's.
 */
export default function SettingsButton({ children }: { children?: ReactNode }) {
  const edge = useNavEdge();
  return (
    <ResponsivePopover>
      <ResponsivePopoverTrigger asChild>
        <IconButton label="Settings" data-testid="settings-button">
          <Settings className="size-5" />
        </IconButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Settings" side={edge === "top" ? "bottom" : "top"} align="end" className="w-72">
        <div className="space-y-3 text-sm [&>div:first-child]:border-t-0 [&>div:first-child]:pt-0">
          <NavBarSetting />
          <DevSwitch />
          <ChartLayers />
          {children}
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
