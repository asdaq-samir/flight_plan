import { useState } from "react";
import { PanelRightIcon } from "lucide-react";
import IconButton from "./IconButton";

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
 * Opens/closes Shell's own sidebar panel -- a plain callback prop,
 * not a Context: every page that has a sidebar renders one of these
 * itself, inline in its own header, rather than Shell rendering one
 * internally.
 *
 * `open` forces this button's own Tooltip shut once the panel is open
 * -- a real boolean from this component's first render on, never
 * toggled to/from `undefined` (Radix decides controlled-vs-uncontrolled
 * once, and flip-flopping the prop's own presence later doesn't
 * un-decide that). Clicking this button doesn't move the pointer off
 * it, so without this, Radix's own hover-intent re-opens the tooltip
 * right as the panel does, and the tooltip's own Escape handling then
 * competes with the panel's for the first press.
 */
export default function SidebarToggleButton({ onClick, open, label, className, variant = "ghost" }: Props) {
  const [tooltipOpen, setTooltipOpen] = useState(false);

  return (
    <IconButton
      label={label}
      tooltip={{ open: tooltipOpen && !open, onOpenChange: setTooltipOpen }}
      variant={variant}
      onClick={onClick}
      aria-expanded={open}
      className={className}
      data-testid="sidebar-trigger-button"
    >
      {/* The drawer slides in from the right, so the panel is drawn on
          the right -- shadcn's own sidebar trigger uses PanelLeft for
          its left sidebar, the same convention mirrored. */}
      <PanelRightIcon className="size-5" />
    </IconButton>
  );
}
