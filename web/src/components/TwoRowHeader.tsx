import type { ReactNode } from "react";
import { Tabs, TabsList } from "./ui/tabs";

interface Props {
  /** Row one's own left/right content -- Plan's route form and its
   *  trailing icons (the pilot console, the Dev link) today, but this
   *  component doesn't assume either is specifically that -- just two
   *  things sharing a row, same as row two below. */
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
      {/* From `sm` up, a three-column grid whose flanking columns match
          each other's width (one empty, one holding the trailing
          content), which is what centers the route form against the
          header's full width rather than against whatever is left next
          to the trailing content. Below `sm` there is no room to
          center: a plain wrapping flex row puts the form first and the
          trailing content at the right, on its own line if it must.
          Never a scroll container -- one that overflows by a pixel
          grows a scrollbar the moment a mouse is attached. */}
      <div className="flex flex-wrap items-center gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="hidden sm:block" />
        {rowOneStart}
        <div className="ml-auto sm:ml-0 sm:justify-self-end">{rowOneEnd}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList>{tabs}</TabsList>
        </Tabs>
        {trailing}
      </div>
    </header>
  );
}
