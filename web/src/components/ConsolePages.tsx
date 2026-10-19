import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PlaceTile } from "./Favorites";
import { ChevronLeft } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import { ListRow } from "./GroupedList";
import { PagesShown } from "./pagesShown";

/** The way to open one of a tab's pages, and the page back came from. */
const Pages = createContext<{ open: (page: string) => void; from: string | null } | null>(null);

/**
 * iOS's navigation inside a console tab, as Settings has it: the tab's
 * own page is a few grouped lists, and a row with a chevron (PageRow)
 * pushes a page of its own over it, with a back button named for the
 * tab. What is looked at now and then -- the reference data, the
 * charts, the versions before the model serving, the longer reading --
 * is a tap away rather than folded under a title in a long scroll.
 * Back is also where a tab change leaves it: each tab starts on its own
 * page. Focus goes as a push and a pop take it: to the page's title,
 * and back to the row that opened it.
 */
export function ConsolePages({ back, pages, children }: {
  /** The tab's name, on the back button. */
  back: string;
  pages: Record<string, { title: string; content: ReactNode }>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  // The tab's own page eases in only coming back to it from a page, as a
  // pop: drawn as Setup opens, it faded in from nothing every time, its
  // switches' icons blinking out and back at each tap on the tab, at the
  // owner's notice ("It's flickering the icons").
  const [popped, setPopped] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // A page starts at its top, with its title the place a screen reader
  // reads on from; back is left to the row's focus (PageRow), which
  // brings it into view.
  useEffect(() => {
    if (!open) return;
    top.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 });
    title.current?.focus({ preventScroll: true });
  }, [open]);
  // Back to the list as the tab holding it is put away (PagesShown).
  const shown = useContext(PagesShown);
  const [wasShown, setWasShown] = useState(shown);
  if (shown !== wasShown) {
    setWasShown(shown);
    if (!shown) {
      setOpen(null);
      setPopped(false);
    }
  }
  const page = open ? pages[open] : undefined;
  return (
    <div ref={top}>
      {page ? (
        // A page of a page -- Personal's Flights, then a flight -- has
        // its own way back, to the page under it, as iOS's navigation
        // does one level at a time: this page's head steps aside while
        // one is open in it, so there is one back button, not two.
        <div
          key={open} data-slot="console-page" data-testid="console-page"
          className="space-y-4 duration-200 animate-in fade-in slide-in-from-right-4 [&:has([data-slot=console-page])>[data-slot=page-head]]:hidden"
        >
          <div className="space-y-4" data-slot="page-head">
            {/* Marked so a swipe to the right takes it (TabBar), as iOS's swipe back. */}
            <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-0.5 px-1.5" data-back-button="" onClick={() => { setPopped(true); setOpen(null); }}>
              <ChevronLeft className="size-5" />
              {back}
            </Button>
            <h3 ref={title} tabIndex={-1} className={cn("font-bold tracking-tight outline-none", TEXT.card)}>{page.title}</h3>
          </div>
          {page.content}
        </div>
      ) : (
        <div className={cn(popped && "duration-200 animate-in fade-in")}>
          <Pages.Provider value={{ open: p => { setFrom(p); setOpen(p); }, from }}>{children}</Pages.Provider>
        </div>
      )}
    </div>
  );
}

/** A row that opens one of the tab's pages: its name, what it holds at
 *  its end as a value, and the chevron. */
export function PageRow({ page, title, description, value, media, testId }: {
  page: string;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  media?: ReactNode;
  testId?: string;
}) {
  const pages = useContext(Pages);
  const row = useRef<HTMLButtonElement>(null);
  const back = pages?.from === page;
  useEffect(() => { if (back) row.current?.focus(); }, [back]);
  return <ListRow ref={row} title={title} description={description} value={value} media={media} chevron onClick={() => pages?.open(page)} data-testid={testId} />;
}

/** A page's tile, as Favorites' places are, its page opened at a tap:
 *  the account's things in Setup, at the owner's ask ("like favorites, an
 *  account can have the 4 things as icons that open in their card"). */
export function PageTile({ page, title, detail, icon, colour, disabled, testId }: {
  page: string;
  title: string;
  detail?: string;
  icon: ReactNode;
  colour: string;
  disabled?: boolean;
  testId?: string;
}) {
  const pages = useContext(Pages);
  return (
    <PlaceTile
      icon={icon} className="text-white" style={{ backgroundColor: colour }} title={title} detail={detail}
      onClick={() => pages?.open(page)} disabled={disabled} testId={testId}
    />
  );
}

/** A numbered step, as a row: its number in the tint's disc, what to
 *  do, and how. */
export function StepRow({ n, title, description }: { n: number; title: ReactNode; description?: ReactNode }) {
  return (
    <ListRow
      title={<span className="font-semibold">{title}</span>}
      description={description}
      media={(
        <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[0.8125rem] font-semibold text-primary-foreground")}>
          {n}
        </span>
      )}
    />
  );
}
