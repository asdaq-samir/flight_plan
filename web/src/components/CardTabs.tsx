import { useRef, type ReactNode, type RefObject } from "react";
import { cn } from "cn";
import { TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

/**
 * A card's tabs: an airport's (PlaceCard), brought back under its actions
 * at the owner's ask (2026-10-29, "bring back the tabs after the
 * buttons") after a day as one scroll (A2). The airplane's card kept its
 * one scroll. The route's own pages are the same stock Tabs (PanelTabs).
 *
 * - CardTabBar: a card's bar, its tabs from a list; tapped, the panel comes
 *   all the way up, and the open one tapped again up there takes it back
 *   half way, as the route's tabs do (PanelTabs).
 * - CardTabPanel: a tab's content, spaced as every card's is.
 * - useCardTab (lib/cardTab): the tab picked, kept for each airport while
 *   the page is open: back from a card over it, the same tab.
 */

/** A card's pages as iOS's segmented control, the stock Tabs' own look:
 *  an airport's Info, Weather, Runways and Charts, at the owner's pick of
 *  the redesign, where they were words over a hairline. 44 tall to a
 *  finger. */
const SEGMENTED = "w-full group-data-[orientation=horizontal]/tabs:h-9 pointer-coarse:group-data-[orientation=horizontal]/tabs:h-11";

export interface CardTabSpec<T extends string> {
  value: T;
  label: ReactNode;
}

export function CardTabBar<T extends string>({ tabs, value, onPick, testIdPrefix, disabled, raise, barRef, className }: {
  tabs: readonly CardTabSpec<T>[];
  value: T;
  /** A tab picked, by a tap or the keyboard. */
  onPick: (tab: T) => void;
  /** Each trigger's test id: `${prefix}-${value}`. */
  testIdPrefix: string;
  /** Greyed, as a card's actions are until its answer comes. */
  disabled?: boolean;
  /** The panel raised as a tab is picked, and lowered as the open one is
   *  tapped again all the way up. */
  raise?: { onExpand: () => void; onLower: () => void };
  barRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  // Which tab was open as this one was pressed: Radix picks a tab on the
  // press, before the click, so the click alone cannot tell "the open one
  // tapped again".
  const openWhenPressed = useRef<T | null>(null);
  const isUp = () => barRef?.current?.closest("[data-panel]")?.getAttribute("data-panel") === "full";
  return (
    <TabsList ref={barRef} className={cn(SEGMENTED, className)}>
      {tabs.map(t => (
        <TabsTrigger
          key={t.value} value={t.value} className="pointer-coarse:text-[0.9375rem]" disabled={disabled} data-testid={`${testIdPrefix}-${t.value}`}
          onPointerDown={() => { openWhenPressed.current = value; }} onKeyDown={() => { openWhenPressed.current = value; }}
          onPointerCancel={() => { openWhenPressed.current = null; }} onBlur={() => { openWhenPressed.current = null; }}
          onClick={() => {
            // Read once and cleared: a click with no press before it
            // (VoiceOver's activate, a switch) must not find an earlier
            // press's tab.
            const was = openWhenPressed.current;
            openWhenPressed.current = null;
            if (raise && was === t.value && isUp()) raise.onLower();
            else {
              onPick(t.value);
              raise?.onExpand();
            }
          }}
        >
          {t.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/** A tab's content in a card: the space under the bar, and between its
 *  groups, every card's. */
export function CardTabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return <TabsContent value={value} className={cn("space-y-5 pt-4", className)}>{children}</TabsContent>;
}
