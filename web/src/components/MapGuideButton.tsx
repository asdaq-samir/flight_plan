import type { ReactNode } from "react";
import { cn } from "cn";
import { Info } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

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
 * factors out. Bottom-left, opening upward (`side="top"`) rather than
 * down off the bottom of the viewport, and level with `Shell`'s own
 * `SidebarTrigger` on the opposite corner (same `bottom-8`, just above
 * Leaflet's own attribution control) -- both map pages now have the
 * exact same bottom-corner layout, nothing left for either caller to
 * override.
 */
export default function MapGuideButton({ ariaLabel, contentClassName, children }: Props) {
  return (
    <div className="absolute left-1 bottom-8 z-[1000]">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            aria-label={ariaLabel}
            data-testid="guide-button"
            className="rounded-full border-2 border-background shadow-[0_2px_10px_rgba(0,0,0,.5)]"
          >
            <Info className="size-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className={cn("z-[1000] max-h-[70vh] overflow-y-auto", contentClassName)}
        >
          <div className="space-y-3 text-sm">{children}</div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
