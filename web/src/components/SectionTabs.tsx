import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { SectionTabsContext } from "./sectionLayout";
import { TEXT } from "../lib/text";

interface Entry { title: string; el: HTMLElement; finding?: "stop" | "caution" }

/** Entries in the order their sections are on the page. */
const inPageOrder = (entries: Entry[]) =>
  [...entries].sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

/**
 * Tabs within a tab, at the pilot's ask, where a tab's sections ran one
 * under another: a row of the tab's sections' titles over them -- the
 * Weather's places, the Airports' fields, the Performance's takeoff and
 * loading -- the one picked shown alone. A row of pills, scrolled sideways
 * where there are more than fit, held at the top as the section scrolls
 * under it. A tab of one section has no row; on paper every section is
 * shown (`all`). A section another tab's row asked for (`want`, GoToTab)
 * is picked. A section whose title flags something (the TFR on the
 * route, VFR not recommended) carries the flag's red or amber mark on its
 * pill, as the panel's tabs do theirs: out of sight, it still shows.
 * The pills are buttons pressed or not, not tab roles: they have no
 * arrow-key roving or tabpanel to keep the promise a tab role makes.
 */
export default function SectionTabs({ all, want, children }: {
  all: boolean;
  want: { section: string; n: number } | null;
  children: ReactNode;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const register = useCallback((title: string, el: HTMLElement, finding?: "stop" | "caution") => {
    setEntries(list => inPageOrder([...list.filter(e => e.el !== el), { title, el, finding }]));
    return () => setEntries(list => list.filter(e => e.el !== el));
  }, []);
  const titles = useMemo(() => [...new Set(entries.map(e => e.title))], [entries]);
  // Each pill's mark, the worst of its sections' flags.
  const marks = useMemo(() => {
    const worst = new Map<string, "stop" | "caution">();
    for (const e of entries) if (e.finding && worst.get(e.title) !== "stop") worst.set(e.title, e.finding);
    return worst;
  }, [entries]);
  const [picked, setPicked] = useState<string | null>(null);
  // Asked for from another tab: picked at once, so the scroll to it
  // (PanelTabs) finds it shown.
  const [wantSeen, setWantSeen] = useState(0);
  if (want && want.n !== wantSeen) {
    setWantSeen(want.n);
    setPicked(want.section);
  }
  const shown = all || titles.length < 2 ? null : picked && titles.includes(picked) ? picked : titles[0]!;
  const api = useMemo(() => ({ register, shown }), [register, shown]);
  const top = useRef<HTMLDivElement>(null);
  const pick = (title: string, button: HTMLButtonElement) => {
    setPicked(title);
    button.scrollIntoView({ inline: "nearest", block: "nearest" });
    // Back to the top of the tab, where the picked section starts.
    const scroller = top.current?.closest<HTMLElement>("[data-testid=navlog-scroller]");
    if (scroller && top.current) scroller.scrollTop = Math.min(scroller.scrollTop, top.current.offsetTop);
  };
  return (
    <SectionTabsContext.Provider value={api}>
      <div ref={top} aria-hidden="true" />
      {shown !== null && (
        <div
          role="group" aria-label="Sections" data-testid="section-tabs"
          className="sticky top-0 z-10 -mr-4 -ml-[max(1rem,env(safe-area-inset-left))] flex gap-2 overflow-x-auto bg-background/90 py-2.5 pr-4 pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur [scrollbar-width:none] print:hidden [&::-webkit-scrollbar]:hidden"
        >
          {titles.map(title => (
            <button
              key={title} type="button" aria-pressed={title === shown} data-testid="section-tab" data-section={title}
              onClick={e => pick(title, e.currentTarget)}
              className={cn(
                // 32 points, its hit area the 44 of a row (index.css's rule,
                // not the pill grown to it).
                "relative h-8 shrink-0 rounded-full px-3.5 font-medium whitespace-nowrap outline-none after:absolute after:inset-x-0 after:-inset-y-1.5 focus-visible:ring-2 focus-visible:ring-ring",
                TEXT.detail,
                title === shown ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-foreground",
              )}
            >
              {title}
              {marks.has(title) && (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -top-0.5 right-0.5 size-2 rounded-full ring-2 ring-background",
                      marks.get(title) === "stop" ? "bg-destructive" : "bg-amber-500",
                    )}
                    data-testid="section-tab-mark" data-finding={marks.get(title)}
                  />
                  {/* The mark is colour only; this is what it says to VoiceOver. */}
                  <span className="sr-only">{marks.get(title) === "stop" ? ", warning" : ", caution"}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {children}
    </SectionTabsContext.Provider>
  );
}

/** A part of a tab that is not a section of its own -- the Nav Log's legs,
 *  its totals and table -- as one of its section tabs, by `title`: in its
 *  pill row first where it comes first, shown while picked. */
export function SectionPane({ title, children }: { title: string; children: ReactNode }) {
  const tabs = useContext(SectionTabsContext);
  const own = useRef<HTMLDivElement>(null);
  const register = tabs?.register;
  useLayoutEffect(() => (register && own.current ? register(title, own.current) : undefined), [register, title]);
  return <div ref={own} data-title={title} hidden={!!tabs?.shown && tabs.shown !== title}>{children}</div>;
}
