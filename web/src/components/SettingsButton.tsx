import { Link, useLocation } from "react-router-dom";
import { Settings } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The bare gear icon every header but Settings' own ends in -- shared,
 * not copy-pasted, between Plan's `mapHeader`, Label's own (near-
 * identical) header, and `FlightBriefingView`'s. `variant` alone
 * carries the active state (solid once you're actually on Settings,
 * ghost everywhere else) -- there's no Settings-specific prop to pass
 * in, since the one thing that varies is the route itself.
 */
export default function SettingsButton() {
  const { pathname, search } = useLocation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant={pathname === "/settings" ? "default" : "ghost"}
          size="icon"
          aria-label="Settings"
        >
          {/* state.from -- not a query param on /settings itself -- is
              what lets Settings' own back button read "where you came
              from" (map, briefing, or Label) and both label and return
              there exactly, including the briefing's own
              ?view=briefing. Plain location state, not lifted into
              every caller's own props: this is the one place in the
              app that already knows the current route without being
              told. */}
          <Link to="/settings" state={{ from: pathname + search }}>
            <Settings className="size-5" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>
  );
}
