import { useContext, type ReactNode } from "react";
import { cn } from "cn";
import { BarOverPicture, PanelSize, TabBarMinimized } from "../../components/mapChrome";

/**
 * The field over the tab bar, Target's way (the owner's screenshot and
 * third pick, 2026-11-04): the sheet's first rows, in the pill and from
 * half way up, are the strip's one field with its Ask pill inside it
 * (OneField, `field`) and under it the planner's tab bar (TabBar,
 * `children`) -- FPL, Airport, Aircraft and Setup, the tab up in its
 * capsule -- so the two can be compared on the phone with the tabs and
 * the strip. The tabs' row keeps the height MapPanel gives the bar
 * alone: 48 in the pill, 56 in the sheet, and a card's minimized bar its
 * own. Over a card's picture in the pill (PillPicture) the bar is the
 * card's name alone, so the field stands aside there.
 */
export default function FieldTabsBar({ field, children }: { field: ReactNode; children: ReactNode }) {
  const size = useContext(PanelSize);
  const minimized = useContext(TabBarMinimized);
  const overPicture = useContext(BarOverPicture);
  const pill = size?.size === "peek";
  return (
    <div className="flex w-full min-w-0 flex-col" data-testid="field-tabs">
      {!overPicture && <div className={cn("px-1", pill ? "pt-0.5 pb-1.5" : "pt-2 pb-1")}>{field}</div>}
      <div className={cn("flex w-full", pill ? "h-12" : minimized ? "min-h-11 pb-4" : "h-14")}>{children}</div>
    </div>
  );
}
