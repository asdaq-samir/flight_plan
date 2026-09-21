import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import DevSwitch from "../../components/DevSwitch";
import MapHeader from "../../components/MapHeader";
import RouteForm from "../../components/RouteForm";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "../../components/ui/sheet";
import {
  Sidebar, SidebarContent, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar,
} from "../../components/ui/sidebar";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { DevButton } from "../dev/DevPanel";
import TrainWorkspace from "../train/TrainWorkspace";
import { PilotButton } from "../pilot/PilotPanel";
import PlanWorkspace from "../plan/PlanWorkspace";

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
 * the developer's drawer is plain state. Escape closes it on a
 * desktop the way the phone's Sheet closes itself.
 */
export default function MapPage({ mode }: { mode: Mode }) {
  const { title, sidebar, console: consoleLabel, Workspace, ConsoleButton, route } = MODES[mode];
  useDocumentTitle(title);
  const [searchParams, setSearchParams] = useSearchParams();
  const [dep, setDep] = useState(searchParams.get("dep")?.toUpperCase() || route[0]);
  const [dest, setDest] = useState(searchParams.get("dest")?.toUpperCase() || route[1]);
  const onRoute = useCallback((d: string, a: string) => { setDep(d); setDest(a); }, []);

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

  // Escape closes the drawer -- unless a layer above it (a popover, a
  // tooltip, the phone's own Sheet) took the press first, which Radix
  // marks by preventing its default.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setSidebarOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <Workspace dep={dep} dest={dest} onRoute={onRoute} sidebarOpen={sidebarOpen} onSidebarOpenChange={setSidebarOpen}>
      {pieces => (
        <SidebarProvider
          open={sidebarOpen} onOpenChange={setSidebarOpen}
          style={{ "--sidebar-width": "22rem" } as CSSProperties}
          className="h-dvh min-h-0 print:h-auto"
        >
          <SidebarSync open={sidebarOpen} onOpenChange={setSidebarOpen} />
          <SidebarInset className="min-h-0 min-w-0 print:hidden">
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
                      and system -- a stock Sheet from the top, modal, so
                      the page waits while it is out. */}
                  <Sheet>
                    <SheetTrigger asChild><ConsoleButton /></SheetTrigger>
                    <SheetContent side="top" className="max-h-[85dvh] gap-0 p-0">
                      {/* The stock header row, with the sheet's own close
                          button at its end; the console's content starts
                          under it. */}
                      <SheetHeader className="border-b py-3">
                        <SheetTitle>{consoleLabel}</SheetTitle>
                        <SheetDescription className="sr-only">The {consoleLabel.toLowerCase()} console</SheetDescription>
                      </SheetHeader>
                      {pieces.console}
                    </SheetContent>
                  </Sheet>
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
          <Sidebar side="right" collapsible="offcanvas" aria-label={sidebar}>
            <SidebarContent className="gap-0 overflow-hidden print:overflow-visible">{pieces.sidebar}</SidebarContent>
          </Sidebar>
        </SidebarProvider>
      )}
    </Workspace>
  );
}

/** The header's drawer button: the stock trigger, named for what the
 *  drawer holds, drawn filled while the drawer is out. */
function DrawerTrigger({ label }: { label: string }) {
  const { open, openMobile, isMobile } = useSidebar();
  return (
    <SidebarTrigger
      aria-label={label}
      aria-expanded={isMobile ? openMobile : open}
      className="aria-expanded:bg-primary aria-expanded:text-primary-foreground aria-expanded:hover:bg-primary/90"
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
