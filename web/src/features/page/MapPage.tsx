import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import MapHeader from "../../components/MapHeader";
import RouteForm from "../../components/RouteForm";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "../../components/ui/sheet";
import { Button } from "../../components/ui/button";
import { PanelRightIcon } from "lucide-react";
import { DevButton } from "../dev/DevButton";
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
 * the header with the route form and two buttons, the
 * map, a console in a Sheet from the top and the drawer at the side --
 * around a different workspace. Everything the two used to keep
 * separately (the route in the header, which drawer is open, the
 * keys that close it) lives here once.
 *
 * The sidebar is the stock one: a fixed panel beside the map from `md`
 * up, a Sheet over it on a phone, opened from the stock trigger in the
 * header. On the pilot's page open is the address (`?view=briefing`),
 * so a pasted link lands on the briefing, `n` toggles it, the DEV
 * address remains the source of truth for a shared route;
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
  const [searchParams, setSearchParams] = useSearchParams();
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
                <div className="flex h-dvh min-h-0 w-full print:h-auto">
          {/* React hoists a rendered <title> into the document head
              itself, so the browser tab says which page this is
              without an effect writing document.title by hand. */}
          <title>{title}</title>
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background print:hidden">
            <MapHeader
              dev={mode === "dev"}
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
                  <DrawerTrigger label={sidebar} open={sidebarOpen} onOpenChange={setSidebarOpen} />
                </>
              )}
            />
            {pieces.notices}
            {/* `isolate`: Leaflet's own panes and controls carry z-indexes
                up to 1000; contained here, the map is one flat layer
                under the sidebar and the sheets. */}
            <div className="relative isolate min-h-0 flex-1 overflow-hidden">{pieces.map}</div>
          </main>
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="right" aria-label={sidebar} className="w-[min(22rem,90vw)] gap-0 p-0 sm:max-w-[22rem]" data-testid="side-drawer">
              <SheetHeader className="sr-only">
                <SheetTitle>{sidebar}</SheetTitle>
                <SheetDescription>{sidebar}</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-hidden">{pieces.sidebar}</div>
            </SheetContent>
          </Sheet>
        </div>
      )}
    </Workspace>
    </Suspense>
  );
}

/** The header's drawer button: the stock trigger, named for what the
 *  drawer holds, drawn filled while the drawer is out. */
function DrawerTrigger({ label, open, onOpenChange }: { label: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} aria-expanded={open}
      data-testid="sidebar-trigger-button" onClick={() => onOpenChange(!open)}>
      <PanelRightIcon />
    </Button>
  );
}
