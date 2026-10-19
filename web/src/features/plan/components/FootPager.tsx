import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "cn";

/**
 * Pages side by side in the sheet's foot, swiped between as an iOS page
 * view is, with its page control's dots under them, at the owner's ask:
 * half way on a phone, FPL's route list in the side view's place and the
 * side view a swipe to the left ("when swiped left profile view
 * appears"). Each page as tall as the foot gives the two, the list
 * scrolling in its own. A sideways scroller, so the tab bar's swipe
 * across the panel leaves it be (TabBar).
 */
export default function FootPager({ pages, page: at, onPage, introFrom, testId }: {
  pages: { label: string; node: ReactNode }[];
  /** Drawn first at this page and slid to `page`, at the owner's ask: the
   *  sheet brought down from all the way up, the side view seen sliding
   *  off to the right, where a swipe brings it back. */
  introFrom?: number;
  /** The page shown, kept by the page round it as the sheet changes
   *  height and the pager is drawn anew (PlanWorkspace's footPage). */
  page: number;
  onPage: (page: number) => void;
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Drawn at the page it was left at, not the first: no slide to it.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && el.clientWidth && Math.round(el.scrollLeft / el.clientWidth) !== at) el.scrollLeft = at * el.clientWidth;
  }, [at]);
  // Drawn as if at `introFrom`, the pages then slid along to the page
  // shown -- a transform on each page, the scroll left where it is, so it
  // ends where it should whatever the browser does with a smooth scroll
  // under a snap (the owner's phone stayed on the side view) -- unless the
  // pilot asks for less motion.
  const introduced = useRef(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (introduced.current || introFrom === undefined || introFrom === at || !el) return;
    introduced.current = true;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const by = (introFrom - at) * 100;
    for (const page of el.querySelectorAll<HTMLElement>(":scope > section")) {
      page.animate([{ transform: `translateX(${-by}%)` }, { transform: "translateX(0)" }], { duration: 450, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    }
    // Once, as it is first drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (i: number) => {
    const el = box.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <div
        ref={box} data-slides=""
        onScroll={() => {
          const el = box.current;
          const shown = el && el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : at;
          if (shown !== at) onPage(shown);
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((page, i) => (
          <section
            key={page.label} aria-label={page.label} data-page={i} data-shown={i === at || undefined}
            // A page out of sight out of the keyboard's and a reader's way.
            inert={i !== at}
            className="h-full w-full shrink-0 snap-start snap-always overflow-x-hidden overflow-y-auto overscroll-y-contain"
          >
            {page.node}
          </section>
        ))}
      </div>
      {/* The page control: a dot a page, the one shown dark, each a tap to
          its page -- a 44-point button round a 6-point dot, the buttons side
          by side (the audit's finding: the dots' own areas were 14). */}
      <div className="flex justify-center pt-0.5 pb-1" aria-label="Pages">
        {pages.map((page, i) => (
          <button
            key={page.label} type="button" onClick={() => go(i)} aria-label={page.label} aria-current={i === at || undefined}
            data-testid="foot-page-dot"
            className="relative grid h-4 w-11 place-items-center after:absolute after:inset-x-0 after:-inset-y-3.5 after:content-['']"
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", i === at ? "bg-foreground/70" : "bg-foreground/25")} />
          </button>
        ))}
      </div>
    </div>
  );
}
