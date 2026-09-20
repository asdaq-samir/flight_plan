import type { ReactNode } from "react";
import { cn } from "cn";
import { Info } from "lucide-react";
import IconButton from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";

interface Props {
  ariaLabel: string;
  /** Each page's own popover needs a different width for its own
   *  content (Plan's score key is narrower than Label's rating scale
   *  plus its own longer shortcut list) -- everything else about the
   *  shell is identical. */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * The bare info-icon button both map pages open their own reference
 * popover from -- Plan's checkpoint-score key (`ScoreLegend`) and
 * Label's rating scale (`RatingLegend`) were two copies of this exact
 * shell around two different bodies of content, which is what this
 * factors out. Inline in the header next to Shell's own
 * `SidebarTrigger`, the same `IconButton` every other icon button in
 * this app's headers is (the gear, the Dev ML flask, Print, the sidebar
 * toggle itself), so this reads as one of that same set rather than a
 * button apart from it. Used to also render as a solid, shadowed circle
 * floating bottom-left over the map, back when Label's own page had no
 * header slot to hold this in yet -- both callers have had one for a
 * while now (see `ScoreLegend`'s/`RatingLegend`'s own git history), so
 * that mode never actually rendered any more; dropped rather than kept
 * as a branch nothing exercises.
 */
export default function MapGuideButton({ ariaLabel, contentClassName, children }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* An "i", not the exclamation mark this used to be: the popover
            is a key and the shortcuts, and an exclamation reads as a
            warning about the map. */}
        <IconButton label={ariaLabel} data-testid="guide-button">
          <Info className="size-5" />
        </IconButton>
      </PopoverTrigger>
      {/* align="end", not Popover's own default "center"/a leading
          "start" -- this button sits in the header's own trailing
          corner on both pages, so a popover anchored to its left edge
          (or centered under it) runs off the right side of the screen;
          anchoring to its right edge instead keeps it on screen
          regardless of viewport width. */}
      <PopoverContent side="bottom" align="end" className={cn("z-[1000]", contentClassName)}>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-3 text-sm">{children}</div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
