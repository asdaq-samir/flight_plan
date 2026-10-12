import { useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { cn } from "cn";
import { LINE_TAB } from "./lineTabs";
import { TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

/**
 * The cards' tabs, one code for every card that has them, at the owner's
 * ask ("make the code common for all the card layouts"): an airport's
 * (PlaceCard), an airplane's (FlightCard), and the consoles' bar
 * (ConsoleTabs). They were each a copy of the same stock line tabs, the
 * behaviour and the sizes drifting apart one by one.
 *
 * - LineTabsList: the bar -- words over a hairline, the chosen one in the
 *   tint and underlined in it, 44 points to a finger, as iOS's tab bars
 *   are; its tabs share it edge to edge.
 * - CardTabBar: a card's bar, its tabs from a list; tapped, the panel comes
 *   all the way up, and the open one tapped again up there takes it back to
 *   half, as the route's tabs do (PanelTabs).
 * - CardTabPanel: a tab's content, spaced as every card's is.
 * - useCardTab (lib/cardTab): the tab picked, kept for each airport or
 *   airplane while the page is open: back from a card over it, the same tab.
 */

const LIST = "w-full gap-0 border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-9 pointer-coarse:group-data-[orientation=horizontal]/tabs:h-11";

export function LineTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <TabsList variant="line" className={cn(LIST, className)} {...props} />;
}

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
    <LineTabsList ref={barRef} className={className}>
      {tabs.map(t => (
        <TabsTrigger
          key={t.value} value={t.value} className={LINE_TAB} disabled={disabled} data-testid={`${testIdPrefix}-${t.value}`}
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
    </LineTabsList>
  );
}

/** A tab's content in a card: the space under the bar, and between its
 *  groups, every card's. */
export function CardTabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return <TabsContent value={value} className={cn("space-y-5 pt-4", className)}>{children}</TabsContent>;
}
