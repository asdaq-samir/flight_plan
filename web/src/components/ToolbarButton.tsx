import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { EXPANDED_BUTTON } from "../lib/expandedButton";

/**
 * A drawer header's action: its icon with a short word under it, as an
 * iOS toolbar draws one. The word is on show; an icon alone (a sparkle,
 * a brain) had to be long-pressed on a phone for its name, and nobody
 * does. `label`, when given, is the accessible name -- the longer name
 * ("Briefing narrative"), which starts with the word shown ("Brief").
 * A stock ghost Button, so it composes like one: a PopoverTrigger or a
 * DropdownMenuTrigger `asChild` outside it, `ref` and every other prop
 * on the button; ringed while what it opened is open.
 */
export default function ToolbarButton({ icon, text, label, className, ...props }: ComponentProps<typeof Button> & {
  icon: ReactNode;
  text: string;
  label?: string;
}) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      className={cn(
        // The word at 11 points, in rem so it grows with the text size
        // as everything round it does: in pixels it stayed 11 at any.
        // To a finger too, as an iOS tab bar's words are (10), where a
        // button's own words are 17 there -- and there on iOS's leading
        // for 11, 13, where the mouse's stays tight under the icon.
        "h-auto min-w-11 flex-col gap-0.5 px-1.5 py-1 text-[0.6875rem] pointer-coarse:text-[0.6875rem] leading-none pointer-coarse:leading-[0.8125rem] font-medium [&_svg:not([class*='size-'])]:size-5",
        EXPANDED_BUTTON,
        className,
      )}
      {...props}
    >
      {icon}
      <span>{text}</span>
    </Button>
  );
}
