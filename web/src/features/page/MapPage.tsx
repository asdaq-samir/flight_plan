import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { EXPANDED_BUTTON } from "../../lib/expandedButton";
import { useSearchParamsNow } from "../../lib/useSearchParamsNow";
import DevSwitch from "../../components/DevSwitch";
import MapHeader from "../../components/MapHeader";
import RouteForm from "../../components/RouteForm";
import { Sheet, SheetContent, SheetTrigger } from "../../components/ui/sheet";
// Under other names: `DrawerTrigger` below is the header's button for
// the sidebar, which this page calls its drawer.
import { Drawer as BottomSheet, DrawerContent as BottomSheetContent, DrawerTrigger as BottomSheetTrigger } from "../../components/ui/drawer";
import { useIsMobile } from "../../hooks/use-mobile";
import {
  Sidebar, SidebarContent, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar,
} from "../../components/ui/sidebar";
import { DevButton } from "../dev/DevButton";
import ConsoleHeader from "../pilot/ConsoleHeader";
import LinkSignIn from "../pilot/LinkSignIn";
import { PilotButton } from "../pilot/PilotPanel";
import PlanWorkspace from "../plan/PlanWorkspace";

/**
 * The training workspace on its own chunk. It carries the developer's
 * console -- charts, tables, the model registry -- and a pilot loading
 * the planner has no use for any of it; eagerly imported here it was
 * about half of the page's JavaScript, parsed on every visit.
 * React's own `lazy`, resolved while the `Suspense` below shows the
 * empty shell.
 */
const TrainWorkspace = lazy(() => import("../train/TrainWorkspace"));

export type Mode = "pilot" | "dev";

/** What differs between the two pages: the words, the workspace, and
 *  the route to start on when the address names none (the planner
 *  asks the server for a collected one instead). */
const MODES = {
  pilot: {
    title: "Plan a route — VFR Route", sidebar: "Flight Planning", console: "Pilot",
    Workspace: PlanWorkspace, ConsoleButton: PilotButton, route: ["", ""] as const,
  },
  dev: {
    title: "Dev — VFR Route", sidebar: "Model Training", console: "Developer",
    Workspace: TrainWorkspace, ConsoleButton: DevButton, route: ["C81", "KDLH"] as const,
  },
};

/**
 * The one page, in two modes: the pilot's planner and the developer's
 * training workspace are the same shell -- shadcn's Sidebar layout,
 * the header with the DEV switch, the route form and two buttons, the
 * map, a console in a Sheet from the top and the drawer at the side --
 * around a different workspace. Everything the two used to keep
 * separately (the route in the header, which drawer is open, the
 * keys that close it) lives here once.
 *
 * The sidebar is the stock one: a fixed panel beside the map from `md`
 * up, a Sheet over it on a phone, opened from the stock trigger in the
 * header. On the pilot's page open is the address (`?view=briefing`),
 * so a pasted link lands on the briefing, `n` toggles it, the DEV
 * switch brings it back with the route and the back button leaves it;
 * the developer's drawer is plain state.
 *
 * Closing it is whatever the stock components already do, and nothing
 * more: on a phone the drawer is a Radix Sheet, which closes on Escape
 * and on a tap outside itself; on a desktop it is shadcn's own panel,
 * which toggles on Cmd/Ctrl+B. A hand-written Escape listener used to
 * paper over the difference, and it is gone -- a keystroke this app
 * binds itself is a keystroke this app has to keep working.
 */
export default function MapPage({ mode }: { mode: Mode }) {
  const { title, sidebar, console: consoleLabel, Workspace, ConsoleButton, route } = MODES[mode];
  const onPhone = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParamsNow();
  // The route in the header: the address's, unless the pilot has typed
  // over it -- and a draft belongs to the address it was typed over. The
  // address is what every query keys on, and it changes in more ways
  // than the form: opening a saved flight, a link from the developer
  // console, Back. The header used to read it once, and was kept in step
  // for only one of those, so after opening a saved flight it still
  // showed the old route, and Load quietly re-planned that instead.
  const addressDep = searchParams.get("dep")?.toUpperCase() || route[0];
  const addressDest = searchParams.get("dest")?.toUpperCase() || route[1];
  const addressKey = `${addressDep}-${addressDest}`;
  const [draft, setDraft] = useState<{ of: string; dep: string; dest: string } | null>(null);
  const typed = draft?.of === addressKey ? draft : null;
  const dep = typed?.dep ?? addressDep;
  const dest = typed?.dest ?? addressDest;
  const setDep = useCallback((d: string) => setDraft({ of: addressKey, dep: d, dest }), [addressKey, dest]);
  const setDest = useCallback((a: string) => setDraft({ of: addressKey, dep, dest: a }), [addressKey, dep]);

  // A Google or Apple sign-in the webapp refused comes back here: an
  // address the provider has not verified can be nobody's pilot. Said
  // once, and taken off the address.
  const refused = searchParams.get("signin") === "refused";
  useEffect(() => {
    if (!refused) return;
    toast.error("That sign-in was refused", {
      description: "The provider has not verified that account's email address. Verify it there, or sign in with an emailed link.",
    });
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("signin");
      return next;
    }, { replace: true });
  }, [refused, setSearchParams]);

  const [localOpen, setLocalOpen] = useState(false);
  const sidebarOpen = mode === "pilot" ? searchParams.get("view") === "briefing" : localOpen;
  const setSidebarOpen = useCallback((open: boolean) => {
    if (mode !== "pilot") { setLocalOpen(open); return; }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (open) next.set("view", "briefing");
      else next.delete("view");
      return next;
    }, { replace: true });
  }, [mode, setSearchParams]);

  return (
    // The fallback is the page's own background rather than a spinner:
    // it is on screen for one request, and a flash of "loading" where
    // a chart is about to be is worse than a moment of nothing.
    <Suspense fallback={<div className="h-dvh w-full bg-background" />}>
    <Workspace dep={dep} dest={dest} sidebarOpen={sidebarOpen}>
      {pieces => (
        <SidebarProvider
          open={sidebarOpen} onOpenChange={setSidebarOpen}
          style={{ "--sidebar-width": "22rem" } as CSSProperties}
          // Pinned to the viewport rather than sized to it (`h-dvh`): a
          // page that can scroll at all, iOS Safari scrolls for its
          // own reasons -- turned to landscape and back, it was left
          // scrolled by the height of the toolbar it had collapsed,
          // with the header off the top of the screen. Pinned, there is
          // nothing to scroll; the drawer and the consoles scroll
          // inside themselves. On paper the drawer flows as a document.
          className="fixed inset-0 min-h-0 print:static print:h-auto"
        >
          {/* React hoists a rendered <title> into the document head
              itself, so the browser tab says which page this is
              without an effect writing document.title by hand. */}
          <title>{title}</title>
          {/* An emailed sign-in link lands here (#signin=…) and is
              finished in the app's own dialog. */}
          <LinkSignIn />
          <SidebarSync open={sidebarOpen} onOpenChange={setSidebarOpen} />
          {/* For a keyboard: past the header's controls to the map in
              one press. Visible only while it has focus. */}
          <a
            href="#content"
            className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm shadow outline-none focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Skip to the map
          </a>
          {/* `@container`: the header's three-column grid is chosen by a
              container query on this width, not a media query, because
              a container query's rem follows the root font size and a
              media query's does not -- so with the text set larger, the
              header falls back to its wrapping row instead of running
              off the edge. */}
          {/* On a phone the header is the bottom row (MapHeader), so the
              top of this column clears the notch or the Dynamic Island
              itself. */}
          <SidebarInset id="content" className="@container min-h-0 min-w-0 max-md:pt-[env(safe-area-inset-top)] print:hidden">
            <MapHeader
              dev={mode === "dev"}
              leading={<DevSwitch />}
              form={(
                <RouteForm
                  dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest}
                  onSubmit={pieces.submit} disabled={pieces.loading}
                />
              )}
              actions={(
                <>
                  {/* The console: the pilot's account, aeroplanes, flights
                      and guide, or the developer's training, performance
                      and system -- modal, so the page waits while it is
                      out. From `md` up a stock Sheet from the top, under
                      its button; on a phone, where the header is the
                      bottom row, a sheet up from the bottom edge with a
                      grabber, as iOS presents one (shadcn's Drawer), on
                      the card surface the Sheet has, so a menu opened in
                      it stands off it in the dark theme. Its height is
                      fixed rather than its content's: sized to the tab
                      showing, its top edge rose and fell as the tabs
                      changed, and the tab row moved out from under the
                      finger that had just tapped it. */}
                  {onPhone ? (
                    <BottomSheet>
                      <BottomSheetTrigger asChild><ConsoleButton /></BottomSheetTrigger>
                      <BottomSheetContent
                        className="h-[85dvh] gap-0 bg-card text-card-foreground data-[vaul-drawer-direction=bottom]:max-h-none"
                        data-testid="console-sheet"
                      >
                        <ConsoleHeader console={consoleLabel.toLowerCase()} />
                        <AfterTheSheet>{pieces.console}</AfterTheSheet>
                      </BottomSheetContent>
                    </BottomSheet>
                  ) : (
                    <Sheet>
                      <SheetTrigger asChild><ConsoleButton /></SheetTrigger>
                      <SheetContent side="top" className="max-h-[85dvh] gap-0 p-0" showCloseButton={false} data-testid="console-sheet">
                        {/* The greeting, the way in or out and the close
                            button on one row; the console's content starts
                            under it. */}
                        <ConsoleHeader console={consoleLabel.toLowerCase()} />
                        <AfterTheSheet>{pieces.console}</AfterTheSheet>
                      </SheetContent>
                    </Sheet>
                  )}
                  <DrawerTrigger label={sidebar} />
                </>
              )}
            />
            {pieces.notices}
            {/* `isolate`: Leaflet's own panes and controls carry z-indexes
                up to 1000; contained here, the map is one flat layer
                under the sidebar and the sheets. */}
            <div className="relative isolate min-h-0 flex-1 overflow-hidden">{pieces.map}</div>
          </SidebarInset>
          {/* h-dvh, overriding the stock panel's own `h-svh`: `svh` is
              the viewport height with the browser's chrome shown, so
              with Safari's toolbar hidden (or collapsed by a scroll)
              the panel ended short by the chrome's height and the page
              showed through below it -- the same white, so it read as
              dead space under the last section. `dvh` is what the rest
              of the shell is sized by, and it tracks what is actually
              visible. */}
          <Sidebar side="right" collapsible="offcanvas" aria-label={sidebar} className="h-dvh">
            <SidebarContent className="gap-0 overflow-hidden print:overflow-visible">{pieces.sidebar}</SidebarContent>
          </Sidebar>
        </SidebarProvider>
      )}
    </Workspace>
    </Suspense>
  );
}

/**
 * A console's content, drawn a moment after the Sheet that holds it.
 * Either console is a few hundred milliseconds of rendering on a
 * phone's processor, and in the same render as the Sheet it held the
 * Sheet back for all of it: the tap seemed to do nothing, then the
 * console arrived whole. Deferred, the Sheet is on screen and sliding
 * in on the next frame, and the console fills it while it does.
 */
function AfterTheSheet({ children }: { children: ReactNode }) {
  const drawn = useDeferredValue(true, false);
  return drawn ? children : <div className="h-40" />;
}

/** The header's drawer button: the stock trigger, named for what the
 *  drawer holds, drawn filled while the drawer is out. */
function DrawerTrigger({ label }: { label: string }) {
  const { open, openMobile, isMobile } = useSidebar();
  return (
    <SidebarTrigger
      aria-label={label}
      aria-expanded={isMobile ? openMobile : open}
      className={cn("size-9", EXPANDED_BUTTON)}
      data-testid="sidebar-trigger-button"
    />
  );
}

/**
 * On a phone the stock sidebar is a Sheet with an open state of its
 * own (`openMobile`), which the provider's controlled `open` does not
 * reach: this keeps the two together both ways -- the page's state
 * (the address, the `n` key) opens and closes the Sheet, and the Sheet
 * closing itself (its overlay, Escape) is written back. Whichever side
 * changed since the last commit is the one followed, so the two never
 * chase each other; with neither changed (the page has just found out
 * it is on a phone), the page's state wins.
 */
function SidebarSync({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const previous = useRef({ open, openMobile });
  useEffect(() => {
    const { open: wasOpen, openMobile: wasOpenMobile } = previous.current;
    previous.current = { open, openMobile };
    if (!isMobile) return;
    if (open !== wasOpen) setOpenMobile(open);
    else if (openMobile !== wasOpenMobile) onOpenChange(openMobile);
    else if (open !== openMobile) setOpenMobile(open);
  }, [open, openMobile, isMobile, setOpenMobile, onOpenChange]);
  return null;
}
