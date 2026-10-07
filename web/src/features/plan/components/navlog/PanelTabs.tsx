import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CloudSun, Gauge, ListOrdered, Sparkles, TowerControl } from "lucide-react";
import { cn } from "cn";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { SectionsOpen } from "../../../../components/sectionLayout";
import { LINE_TAB } from "../../../../components/lineTabs";
import { GoToTab, type PanelTab } from "./panelTab";

/** The panel's tabs, in the pilot's order: the Nav Log (the route's
 *  profile under it: the same legs from the side), the Brief, the Weather,
 *  the aeroplane's Performance and the Airports -- each an icon over its
 *  word, as iOS's tab bar draws one, so all five fit a phone's line at any
 *  text size, where six words did not at the pilot's. */
const TABS: { value: PanelTab; label: string; icon: ReactNode }[] = [
  { value: "navlog", label: "Nav Log", icon: <ListOrdered /> },
  { value: "brief", label: "Brief", icon: <Sparkles /> },
  { value: "weather", label: "Weather", icon: <CloudSun /> },
  { value: "performance", label: "Performance", icon: <Gauge /> },
  { value: "airports", label: "Airports", icon: <TowerControl /> },
];
/** On paper every tab, one after another: the nav log first, as a
 *  pilot flies from it. */
const PRINTED: PanelTab[] = ["navlog", "weather", "airports", "performance", "brief"];

/**
 * The planning panel's tabs and what is under them (NavLogView's), with
 * the tab up kept here: a switch draws this and nothing else -- the tabs'
 * contents come in as elements made by the panel, unchanged by a switch,
 * so React leaves them be. Each tab is kept once opened, hidden, and back
 * at once, scrolled where it was left -- a switch drew the whole tab
 * again, 0.4 to 0.75 s of a phone's main thread each time (measured at a
 * quarter of a laptop's speed), and every tab shared one scroll. Hidden
 * plainly, not under React's Activity: its effects stopped and started
 * again on every return, half a second of the Nav Log's. The nav log's is
 * up to begin with -- the Brief's narrative is a billed call, asked for
 * when its tab opens -- and again when a checkpoint is picked on the map
 * (`pick`): that is what the pilot opened the panel to see.
 */
export default function PanelTabs({ rootRef, before, contents, notice, footer, children, printing, local, marks, pick }: {
  rootRef: (el: HTMLDivElement | null) => void;
  /** Over the tabs: the printed title and the flight's line. */
  before: ReactNode;
  contents: Record<PanelTab, ReactNode>;
  notice?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  printing: boolean;
  local: boolean;
  /** A tab whose findings (lib/verdict) have something to fix, or to
   *  look at. */
  marks?: Partial<Record<PanelTab, "stop" | "caution">>;
  /** A checkpoint picked on the map with the panel out, by its key. */
  pick: string | null;
}) {
  const [tab, setTab] = useState<PanelTab>("navlog");
  const [opened, setOpened] = useState<PanelTab[]>(["navlog"]);
  if (!opened.includes(tab)) setOpened([...opened, tab]);
  // Once per pick; state adjusted during render, React's own pattern for a
  // change of props, rather than an effect that would draw twice.
  const [pickedFor, setPickedFor] = useState<string | null>(null);
  if (pick !== pickedFor) {
    setPickedFor(pick);
    if (pick && tab !== "navlog") setTab("navlog");
  }
  const scroller = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Partial<Record<PanelTab, number>>>({});
  // The section a row in another tab asked for (GoToTab), scrolled to
  // once its tab is drawn.
  const wanted = useRef<string | null>(null);
  const [asked, setAsked] = useState(0);
  const choose = useCallback((next: string) => {
    if (scroller.current) scrolls.current[tab] = scroller.current.scrollTop;
    setTab(next as PanelTab);
  }, [tab]);
  const goTo = useCallback((next: PanelTab, section?: string) => {
    wanted.current = section ?? null;
    if (section) scrolls.current[next] = 0;
    choose(next);
    setAsked(n => n + 1);
  }, [choose]);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    box.scrollTop = scrolls.current[tab] ?? 0;
    const section = wanted.current;
    wanted.current = null;
    if (!section) return;
    // To the section's top, under the tabs; twice, the second after a
    // frame, as the sections above it are laid out only near the screen
    // (content-visibility) and the first move is on their estimates.
    const to = () => {
      const target = box.querySelector(`[data-tab="${tab}"] [data-title="${CSS.escape(section)}"]`);
      if (target) box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
    };
    to();
    const frame = requestAnimationFrame(to);
    return () => cancelAnimationFrame(frame);
  }, [tab, asked]);
  return (
    // print:h-auto print:overflow-visible: on screen this fills a fixed
    // viewport height and clips to it, deliberately -- on paper there
    // is no viewport to clip to, and a route long enough to scroll
    // would otherwise print only whatever page's worth happened to be
    // visible.
    <Tabs ref={rootRef} value={tab} onValueChange={choose} className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden print:h-auto print:overflow-visible">
      {before}
      {/* The stock line tabs, as the consoles' (ConsoleTabs), over the
          scroller so they stay as it scrolls: an icon over its word, the
          word at iOS tab bar's own fixed size (it does not grow with the
          text, as iOS's does not), so the five share the line evenly. A
          tab whose findings (lib/verdict) have something to fix carries a
          red mark, something to look at an amber one, as its sections'
          titles do. */}
      <TabsList
        variant="line"
        className="h-auto w-full shrink-0 gap-0 border-b border-border px-[max(0.25rem,env(safe-area-inset-left))] group-data-[orientation=horizontal]/tabs:h-auto pointer-coarse:group-data-[orientation=horizontal]/tabs:h-auto print:hidden"
      >
        {TABS.map(t => (
          <TabsTrigger
            key={t.value} value={t.value} data-testid={`panel-tab-${t.value}`}
            className={cn(LINE_TAB, "min-w-0 flex-1 flex-col gap-0.5 px-0.5 py-1.5 text-[11px] leading-tight pointer-coarse:text-[11px] pointer-coarse:max-[374px]:text-[11px] max-[374px]:px-0 [&_svg]:size-5")}
          >
            <span className="relative">
              {t.icon}
              {marks?.[t.value] && (
                <span
                  className={cn("absolute -top-0.5 -right-1 size-2 rounded-full", marks[t.value] === "stop" ? "bg-destructive" : "bg-amber-500")}
                  data-testid={`panel-tab-mark-${t.value}`} data-finding={marks[t.value]}
                />
              )}
            </span>
            {/* "Local" for one airport to itself: "Local Flight" came
                within 16 points of the panel's side. */}
            <span className="truncate">{t.value === "navlog" && local ? "Local" : t.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <div
        ref={scroller}
        // The bottom inset clears the home indicator on an installed
        // app, so the last section's content is not under it.
        // `flight-briefing`: index.css's print rules lay every tab out on
        // paper.
        className="flight-briefing @container min-h-0 flex-1 overflow-auto pr-4 pb-[env(safe-area-inset-bottom)] pl-[max(1rem,env(safe-area-inset-left))] print:h-auto print:overflow-visible print:pb-0"
        data-testid="navlog-scroller"
      >
        {notice}
        <SectionsOpen.Provider value>
          <GoToTab.Provider value={goTo}>
            {(printing ? PRINTED : TABS.map(t => t.value).filter(t => opened.includes(t))).map(t => (
              <TabsContent key={t} value={t} forceMount className="mt-0" data-testid={`panel-${t}`} data-tab={t} hidden={!printing && t !== tab}>
                {contents[t]}
              </TabsContent>
            ))}
          </GoToTab.Provider>
        </SectionsOpen.Provider>
        {footer}
      </div>
      {children}
    </Tabs>
  );
}
