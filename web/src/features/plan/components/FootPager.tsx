import { useRef, useState, type ReactNode } from "react";
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
export default function FootPager({ pages, testId }: { pages: { label: string; node: ReactNode }[]; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const go = (i: number) => {
    const el = box.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <div
        ref={box}
        onScroll={() => { const el = box.current; if (el && el.clientWidth) setAt(Math.round(el.scrollLeft / el.clientWidth)); }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((page, i) => (
          <section
            key={page.label} aria-label={page.label} data-page={i} data-shown={i === at || undefined}
            // A page out of sight out of the keyboard's and a reader's way.
            inert={i !== at}
            className="h-full w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain"
          >
            {page.node}
          </section>
        ))}
      </div>
      {/* The page control: a dot a page, the one shown dark, each a tap to
          its page, their 44-point areas meeting across the row. */}
      <div className="flex justify-center gap-2 pt-1 pb-1.5" aria-label="Pages">
        {pages.map((page, i) => (
          <button
            key={page.label} type="button" onClick={() => go(i)} aria-label={page.label} aria-current={i === at || undefined}
            data-testid="foot-page-dot"
            className={cn(
              "relative size-1.5 rounded-full after:absolute after:-inset-x-1 after:-inset-y-[19px] after:content-['']",
              i === at ? "bg-foreground/70" : "bg-foreground/25",
            )}
          />
        ))}
      </div>
    </div>
  );
}
