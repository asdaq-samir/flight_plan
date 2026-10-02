import type { ComponentProps } from "react";
import { Settings } from "lucide-react";
import IconButton from "./IconButton";

/**
 * The map's button that opens the console, the same on both pages: a
 * gear, as an iOS app's settings are, where the planner had a person
 * (the pilot's) and the dev page a terminal (the developer's). Which
 * console it opens is the page's, and a developer switches between the
 * two in the console's title (ConsoleHeader). A trigger's child, so the
 * sheet's own open state, click and `aria-expanded` arrive as props.
 */
export default function SettingsButton(props: Omit<ComponentProps<typeof IconButton>, "label" | "children">) {
  return (
    <IconButton label="Settings" data-testid="settings-button" {...props}>
      <Settings className="size-5" strokeWidth={1.75} />
    </IconButton>
  );
}
