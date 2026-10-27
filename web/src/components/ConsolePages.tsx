import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { ListRow } from "./GroupedList";
import { PagesShown } from "./pagesShown";
import { holdOpenCard } from "../lib/openCards";
import CloseButton from "./CloseButton";

/** The way to open one of a tab's pages, and the page back came from. */
const Pages = createContext<{ open: (page: string) => void; from: string | null } | null>(null);

/**
 * iOS's navigation inside a console tab, as Settings has it: the tab's
 * own page is a few grouped lists, and a row with a chevron (PageRow)
 * pushes a page of its own over it, its close at its title's right
 * going back a page -- no Back on the left, at the owner's ask ("remove
 * the back buttons, because close button should behave as the back
 * button", 2026-10-22) -- as a swipe to the right and a device's Back do
 * (lib/openCards). What is looked at now and then -- the reference data, the
 * charts, the versions before the model serving, the longer reading --
 * is a tap away rather than folded under a title in a long scroll.
 * Back is also where a tab change leaves it: each tab starts on its own
 * page. Focus goes as a push and a pop take it: to the page's title,
 * and back to the row that opened it.
 */
export function ConsolePages({ back, pages, children }: {
  /** The tab's name: where the page's close goes back to, said to a
   *  screen reader. */
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
  // The page open is the top of what the close, a swipe back and a
  // device's Back take away, one at a time: a page of a page first.
  useEffect(() => {
    if (!open) return;
    return holdOpenCard({ close: () => { setPopped(true); setOpen(null); }, inBar: false });
  }, [open]);
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
        // A page of a page -- Personal's Flights, then a flight -- goes
        // back to the page under it, as iOS's navigation does one level
        // at a time: this page's head steps aside while one is open in it.
        <div
          key={open} data-slot="console-page" data-testid="console-page"
          className="space-y-4 duration-200 animate-in fade-in slide-in-from-right-4 [&:has([data-slot=console-page])>[data-slot=page-head]]:hidden"
        >
          <div className="flex items-center gap-2" data-slot="page-head">
            <h3 ref={title} tabIndex={-1} className={cn("flex-1 font-bold tracking-tight outline-none", TEXT.card)}>{page.title}</h3>
            <CloseButton label={`Back to ${back}`} className="-mr-1" onClick={() => { setPopped(true); setOpen(null); }} data-testid="console-page-close" />
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
export function PageRow({ page, title, description, value, media, testId, disabled }: {
  page: string;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  media?: ReactNode;
  testId?: string;
  /** Waiting on something: the account's things signed out. */
  disabled?: boolean;
}) {
  const pages = useContext(Pages);
  const row = useRef<HTMLButtonElement>(null);
  const back = pages?.from === page;
  useEffect(() => { if (back) row.current?.focus(); }, [back]);
  return <ListRow ref={row} title={title} description={description} value={value} media={media} chevron disabled={disabled} onClick={() => pages?.open(page)} data-testid={testId} />;
}

/** A page opened by a tap anywhere on a block of the caller's own -- the
 *  account's card in Setup, its details. */
export function PageButton({ page, label, testId, children }: { page: string; label: string; testId?: string; children: ReactNode }) {
  const pages = useContext(Pages);
  return (
    <button
      type="button" onClick={() => pages?.open(page)} aria-label={label} data-testid={testId}
      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** A page opened from a link in the tint, at a page's foot: Setup's Guide
 *  and About, at the owner's pick (T3). Its 44 points a pseudo-element
 *  round the words, the words not grown. */
export function PageLink({ page, children, testId }: { page: string; children: ReactNode; testId?: string }) {
  const pages = useContext(Pages);
  return (
    <button
      type="button" onClick={() => pages?.open(page)} data-testid={testId}
      className={cn("relative rounded-sm text-tint outline-none after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail)}
    >
      {children}
    </button>
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
