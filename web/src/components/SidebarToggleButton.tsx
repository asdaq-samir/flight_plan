import { useState } from "react";
import { PanelLeftIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface Props {
  onClick: () => void;
  /** Whether the Drawer this button opens is currently open -- forces
   *  this button's own tooltip shut while true (see this component's
   *  own comment on why). */
  open: boolean;
  /** What the sidebar actually holds -- "Nav Log" on Plan, "Waypoints"
   *  on Label -- rather than a generic "Toggle Sidebar" naming the
   *  mechanism instead of the content, the same restraint every other
   *  icon button in this app's headers already gets (Print names what
   *  it prints, Dev ML names what it opens). */
  label: string;
  className?: string;
  variant?: "default" | "ghost";
}

/**
 * Opens/closes Shell's own sidebar Drawer -- a plain callback prop,
 * not a Context: every page that has a sidebar renders one of these
 * itself, inline in its own header, rather than Shell rendering one
 * internally.
 *
 * `open` forces this button's own Tooltip shut once the Drawer is open
 * -- a real boolean from this component's first render on, never
 * toggled to/from `undefined` (Radix decides controlled-vs-uncontrolled
 * once, and flip-flopping the prop's own presence later doesn't
 * un-decide that). Clicking this button doesn't move the pointer off
 * it, so without this, Radix's own hover-intent re-opens the tooltip
 * right as the Drawer does; its freshly re-mounted `DismissableLayer`
 * then registers *after* (so: above) the Drawer's own, stealing
 * Escape's first press for itself instead of closing the sidebar.
 */
export default function SidebarToggleButton({ onClick, open, label, className, variant = "ghost" }: Props) {
  const [tooltipOpen, setTooltipOpen] = useState(false);

  return (
    <Tooltip open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size="icon"
          onClick={onClick}
          className={cn(className)}
          data-testid="sidebar-trigger-button"
        >
          <PanelLeftIcon className="size-5" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
