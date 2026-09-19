import type { ReactNode } from "react";
import { Tabs, TabsList } from "./ui/tabs";

interface Props {
  /** Row one's own left/right content -- a route form and a trailing
   *  icon button on both callers today (Plan's own `RouteForm` +
   *  `SettingsButton`, Settings' own Dev-Label-only route form + Map
   *  icon), but this component doesn't assume either is specifically
   *  that -- just two things sharing a row, same as row two below. */
  rowOneStart: ReactNode;
  rowOneEnd: ReactNode;
  tab: string;
  onTabChange: (value: string) => void;
  /** `TabsTrigger` elements -- this component owns the `Tabs`/
   *  `TabsList` wrapper around them, not just the row they sit in. */
  tabs: ReactNode;
  /** Row two's own trailing content, next to the tabs -- whichever
   *  view-specific actions belong to the currently active one. */
  trailing?: ReactNode;
}

/**
 * The two-row header shape Plan's own `mapHeader` and Settings' own
 * header converged on independently and then turned out to be
 * byte-identical in their own outer structure (route form/icon row,
 * then a tabs/trailing-actions row) -- factored out once that became
 * true, rather than the two staying two copies that could quietly
 * drift apart. Label's own standalone header is deliberately NOT built
 * from this: it's a single row with no tabs of its own at all, a
 * genuinely different shape, not a small variation on this one.
 */
export default function TwoRowHeader({
  rowOneStart, rowOneEnd, tab, onTabChange, tabs, trailing,
}: Props) {
  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-background px-3 py-2 print:hidden">
      {/* grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)], not a plain flex
          `justify-between` -- the two flanking columns always match
          each other's width (one empty, one holding the real trailing
          content), which is what actually centers the middle column
          against the header's own full width rather than just against
          whatever's left over next to the trailing content's own size.
          `minmax(0, ...)`, not a bare `1fr` -- a bare `1fr` track won't
          shrink past its own content's natural minimum, so on a narrow
          phone the trailing content (icon buttons that can't compress
          any further) pushed past the screen edge instead of just
          squeezing the centering; `overflow-x-auto` below is the
          fallback for whatever's still too tight even at that minimum. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 overflow-x-auto">
        <div />
        {rowOneStart}
        <div className="justify-self-end">{rowOneEnd}</div>
      </div>
      <div className="flex items-center justify-between gap-2 overflow-x-auto">
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList>{tabs}</TabsList>
        </Tabs>
        {trailing}
      </div>
    </header>
  );
}
