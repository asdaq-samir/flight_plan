import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { SectionsOpen } from "../../../../components/sectionLayout";
import SectionTabs from "../../../../components/SectionTabs";
import { GoToTab, LEGS, useTabAsk, type PanelTab } from "./panelTab";

/** The panel's tabs, in the pilot's order: the Nav Log (the route's
 *  profile under it: the same legs from the side), the Brief, the Weather
 *  and the airplane's Performance -- each an icon over its word, as iOS's
 *  tab bar draws one, so all of them fit a phone's line at any text size,
 *  where six words did not at the pilot's. The airports the flight uses
 *  are sections of the Brief, at the pilot's ask (2026-10-12), where they
 *  were a fifth tab: the planner's own tab bar has an Airport tab. */
const TABS: { value: PanelTab; label: string; short?: string }[] = [
  { value: "navlog", label: "Nav Log" },
  { value: "brief", label: "Brief" },
  { value: "weather", label: "Weather" },
  // "Perf" on the tab, at the pilot's ask: the whole word filled its fifth
  // of a phone's line edge to edge at 13; its name says it whole.
  { value: "performance", label: "Performance", short: "Perf" },
];
/** On paper every tab, one after another: the nav log first, as a
 *  pilot flies from it. */
const PRINTED: PanelTab[] = ["navlog", "weather", "performance", "brief"];

/**
 * The planning panel's tabs and what is under them (NavLogView's), with
 * the tab up kept here: a switch draws this and nothing else -- the tabs'
 * contents come in as elements made by the panel, unchanged by a switch,
 * so React leaves them be. Each tab is kept once opened, hidden, and back
 * at once, scrolled where it was left -- a switch drew the whole tab
 * again, 0.4 to 0.75 s of a phone's main thread each time (measured at a
 * quarter of a laptop's speed), and every tab shared one scroll. Hidden
 * plainly, not under React's Activity: its effects stopped and started
 * again on every return, half a second of the Nav Log's. And hidden with
 * its layout kept (index.css's tab-away), not taken out of it: shown
 * again from display: none, a tab was laid out from nothing -- 0.6 s of
 * the Nav Log's on a phone -- and its charts, measured at nothing while
 * hidden, drawn again from nothing. The nav log's is
 * up to begin with -- the Brief's narrative is a billed call, asked for
 * when its tab opens -- and again when a checkpoint is picked on the map
 * (`pick`): that is what the pilot opened the panel to see.
 */
export default function PanelTabs({ rootRef, before, contents, notice, footer, children, printing, local, marks, pick, onTap, route }: {
  rootRef: (el: HTMLDivElement | null) => void;
  /** Over the tabs: the printed title. */
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
  /** A tab tapped, the one up too (`again`): the panel all the way up to
   *  show it, at the pilot's ask -- at half the bar is the panel's last
   *  line -- and the one up tapped again there, back to half. */
  onTap?: (again: boolean) => void;
  /** Which route the contents are of: drawn just after the frame that
   *  shows a new one (below). */
  route: string;
}) {
  // The tabs' contents drawn just after the frame that shows a new route,
  // not in it: the route's box, its figures and the map first, the nav
  // log's rows and the briefing's sections a moment later, in the
  // background (useDeferredValue's first value) -- at half the panel ends
  // at the tabs, and they are out of sight anyway. In the same frame they
  // held Fly Here's route back 2.5 to 3.6 s at a phone's speed (measured
  // 2026-10-08). On paper at once.
  const drawnFor = useDeferredValue(route, "");
  const drawn = printing || drawnFor === route;
  const [tab, setTab] = useState<PanelTab>("navlog");
  const [opened, setOpened] = useState<PanelTab[]>(["navlog"]);
  if (!opened.includes(tab)) setOpened([...opened, tab]);
  // Once per pick; state adjusted during render, React's own pattern for a
  // change of props, rather than an effect that would draw twice.
  const [pickedFor, setPickedFor] = useState<string | null>(null);
  // And which tab's section tabs (SectionTabs) are to pick which: the
  // legs for a checkpoint picked, a row's section from the Brief.
  const [want, setWant] = useState<{ tab: PanelTab; section: string; n: number } | null>(null);
  if (pick !== pickedFor) {
    setPickedFor(pick);
    if (pick && tab !== "navlog") setTab("navlog");
    if (pick) setWant(w => ({ tab: "navlog", section: LEGS, n: (w?.n ?? 0) + 1 }));
  }
  const scroller = useRef<HTMLDivElement>(null);
  // The tab that was up as a finger or a key pressed one, before Radix
  // makes the pressed one the tab up (on its mouse down or key down, ahead
  // of the click): whether the tap was on the tab already up.
  const upWhenPressed = useRef<PanelTab | null>(null);
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
    if (section) setWant(w => ({ tab: next, section, n: (w?.n ?? 0) + 1 }));
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
    // To the section's top, under the tabs and its tab's pills, held at
    // the top (SectionTabs); twice, the second after a frame, as the
    // sections above it are laid out only near the screen
    // (content-visibility) and the first move is on their estimates.
    const to = () => {
      const target = box.querySelector(`[data-tab="${tab}"] [data-title="${CSS.escape(section)}"]`);
      const pills = box.querySelector(`[data-tab="${tab}"] [data-testid="section-tabs"]`);
      const under = pills?.getBoundingClientRect().height ?? 0;
      if (target) box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - under;
    };
    to();
    const frame = requestAnimationFrame(to);
    return () => cancelAnimationFrame(frame);
  }, [tab, asked]);
  // A tab and section asked for from outside the tabs (useTabAsk): heard
  // as it is asked, and once drawn, one asked before the tabs were there.
  useEffect(() => {
    const hear = () => {
      const { ask, heard } = useTabAsk.getState();
      if (!ask) return;
      heard();
      goTo(ask.tab, ask.section);
    };
    queueMicrotask(hear);
    return useTabAsk.subscribe(hear);
  }, [goTo]);
  return (
    // print:h-auto print:overflow-visible: on screen this fills a fixed
    // viewport height and clips to it, deliberately -- on paper there
    // is no viewport to clip to, and a route long enough to scroll
    // would otherwise print only whatever page's worth happened to be
    // visible.
    <Tabs ref={rootRef} value={tab} onValueChange={choose} className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden print:h-auto print:overflow-visible">
      {before}
      {/* The stock line tabs, as the consoles' (ConsoleTabs), over the
          scroller so they stay as it scrolls: an icon over its word, at a
          fixed size (it does not grow with the text, as iOS's tab bar's
          does not), so the five share the line evenly -- a 24-point glyph
          over a note's 13, at the pilot's ask: at 20 over 11 the way into
          the panel was its smallest type, under the content's 17 and 20
          (the proportion audit, 2026-10-07). A
          tab whose findings (lib/verdict) have something to fix carries a
          red mark, something to look at an amber one, as its sections'
          titles do. */}
      {/* The route's pages as the same segmented control every card's are
          (CardTabBar), at the owner's pick of the redesign: words, the
          glyphs gone, a page with something to fix or look at marked by a
          dot after its word as before. */}
      <TabsList
        data-tip="tabs"
        className="mx-4 my-2 w-auto shrink-0 group-data-[orientation=horizontal]/tabs:h-9 pointer-coarse:group-data-[orientation=horizontal]/tabs:h-11 print:hidden"
      >
        {TABS.map(t => (
          <TabsTrigger
            key={t.value} value={t.value} data-testid={`panel-tab-${t.value}`} aria-label={t.short ? t.label : undefined}
            aria-description={marks?.[t.value] ? (marks[t.value] === "stop" ? "Warning" : "Caution") : undefined}
            onPointerDown={() => { upWhenPressed.current = tab; }} onKeyDown={() => { upWhenPressed.current = tab; }}
            onClick={() => onTap?.(upWhenPressed.current === t.value)}
            className="min-w-0"
          >
            {/* "Local" for one airport to itself: "Local Flight" came
                within 16 points of the panel's side. */}
            <span className="truncate">{t.value === "navlog" && local ? "Local" : t.short ?? t.label}</span>
            {marks?.[t.value] && (
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", marks[t.value] === "stop" ? "bg-destructive" : "bg-amber-500")}
                data-testid={`panel-tab-mark-${t.value}`} data-finding={marks[t.value]}
              />
            )}
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
            {drawn && (printing ? PRINTED : TABS.map(t => t.value).filter(t => opened.includes(t))).map(t => {
              const away = !printing && t !== tab;
              return (
                <TabsContent
                  key={t} value={t} forceMount data-testid={`panel-${t}`} data-tab={t}
                  inert={away} className={cn("mt-0", away && "tab-away")}
                >
                  <SectionTabs all={printing} want={want?.tab === t ? want : null}>{contents[t]}</SectionTabs>
                </TabsContent>
              );
            })}
          </GoToTab.Provider>
        </SectionsOpen.Provider>
        {footer}
      </div>
      {children}
    </Tabs>
  );
}
