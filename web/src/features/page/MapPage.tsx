import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { useSearchParamsNow } from "../../lib/useSearchParamsNow";
import DevGuard from "../../components/DevGuard";
import MapPanel from "../../components/MapPanel";
import { ConsoleSettingsContext, MapButtonsContext, MapInsetsContext, NO_INSETS, type MapInsets, type PanelState } from "../../components/mapChrome";
import RouteForm from "../../components/RouteForm";
import SettingsPanel from "../../components/SettingsPanel";
import { Sheet, SheetContent, SheetTrigger } from "../../components/ui/sheet";
// Under other names: the console's sheet up from the bottom of a phone.
import { Drawer as BottomSheet, DrawerContent as BottomSheetContent, DrawerTrigger as BottomSheetTrigger } from "../../components/ui/drawer";
import { Dialog, DialogContent, DialogTrigger } from "../../components/ui/dialog";
import { useIsMobile } from "../../hooks/use-mobile";
import { useIsTablet } from "../../hooks/use-tablet";
import { useNavEdge } from "../../hooks/use-nav-edge";
import { usePreferences } from "../../lib/preferences";
import { DevButton } from "../dev/DevButton";
import ConsoleHeader from "../pilot/ConsoleHeader";
import LinkSignIn from "../pilot/LinkSignIn";
import { PilotButton } from "../pilot/PilotPanel";
import PlanWorkspace from "../plan/PlanWorkspace";
import type { WorkspacePieces } from "./workspace";

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
    title: "Plan a route — Wingtip Maps", panel: "Flight Planning", console: "Pilot",
    Workspace: PlanWorkspace, ConsoleButton: PilotButton, route: ["", ""] as const,
  },
  dev: {
    title: "Dev — Wingtip Maps", panel: "Model Training", console: "Developer",
    Workspace: TrainWorkspace, ConsoleButton: DevButton, route: ["C81", "KDLH"] as const,
  },
};

/**
 * The one page, in two modes: the pilot's planner and the developer's
 * training workspace are the same shell around a different workspace --
 * the chart filling the screen, the map's buttons floating over it, and
 * one panel over it the way Maps on an iPhone has one (MapPanel): the
 * route form and the console's button always in sight, and under them
 * the workspace's own content, the nav log and the briefing or the
 * training list. Everything the two used to keep separately (the
 * route, how far the panel is out, the console) lives here once.
 *
 * How far the panel is out is the address on the pilot's page while it
 * is all the way out (`?view=briefing`), so a pasted link lands on the
 * briefing and the back button leaves it; the rest of the time, and on
 * the developer's page, it is plain state.
 */
export default function MapPage({ mode }: { mode: Mode }) {
  const { title, panel: panelLabel, console: consoleLabel, Workspace, ConsoleButton, route } = MODES[mode];
  const onPhone = useIsMobile();
  const onTablet = useIsTablet();
  const navBar = usePreferences(s => s.navBar);
  const edge = useNavEdge();
  const [searchParams, setSearchParams] = useSearchParamsNow();
  // The route in the panel: the address's, unless the pilot has typed
  // over it -- and a draft belongs to the address it was typed over. The
  // address is what every query keys on, and it changes in more ways
  // than the form: opening a saved flight, a link from the developer
  // console, Back. The form used to read it once, and was kept in step
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

  // How far the panel is out. All the way, on the planner, is the
  // address; half and resting are this page's own.
  const [localPanel, setLocalPanel] = useState<PanelState>("peek");
  const briefingInAddress = searchParams.get("view") === "briefing";
  const panel: PanelState = mode === "pilot"
    ? (briefingInAddress ? "full" : localPanel === "full" ? "peek" : localPanel)
    : localPanel;
  // flushSync: the panel moves the moment the address says so. React
  // Router lands a navigation in a transition, which a busy page (the
  // plan streaming in) holds back, and the toggle read the state from
  // before it: a close pressed then opened it again, one run in three
  // under load.
  const setPanel = useCallback((next: PanelState) => {
    setLocalPanel(next);
    if (mode !== "pilot" || (next === "full") === briefingInAddress) return;
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === "full") params.set("view", "briefing");
      else params.delete("view");
      return params;
    }, { replace: true, flushSync: true });
  }, [mode, briefingInAddress, setSearchParams]);

  // What the panel covers of the map at rest, for the map to fit a
  // route clear of it and lift its chart credit above it. Kept when it
  // has not changed, so a measurement that comes out the same does not
  // render the page again.
  const [insets, setInsets] = useState<MapInsets>(NO_INSETS);
  const changeInsets = useCallback((next: MapInsets) => {
    setInsets(prev => (prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left ? prev : next));
  }, []);

  // The console, first of the map's buttons: its button there, and the
  // sheet it opens, with the settings as its last tab (ConsoleTabs) --
  // the pilot's account, aeroplanes, flights and guide, or the
  // developer's training, performance and system. Modal, so the page
  // waits while it is out. From the navigation bar's edge (useNavEdge):
  // on a phone a sheet up from the bottom edge with a grabber, as iOS
  // presents one (shadcn's Drawer), or a stock Sheet from the top. On the
  // card surface the Sheet has, so a menu opened in it stands off it in
  // the dark theme. From the bottom its height is fixed rather than its
  // content's: sized to the tab showing, its top edge rose and fell as
  // the tabs changed, and the tab row moved out from under the finger
  // that had just tapped it. On an iPad, iOS's form sheet instead: a
  // card 540 by 620, centred, as a sheet there is.
  const consoleOf = (pieces: WorkspacePieces) => {
    // The greeting, the way in or out and the close button on one row;
    // the console's content starts under it.
    const content = (
      <>
        <ConsoleHeader console={consoleLabel.toLowerCase()} />
        <ConsoleSettingsContext.Provider value={<SettingsPanel page={pieces.settings} />}>
          <AfterTheSheet>{pieces.console}</AfterTheSheet>
        </ConsoleSettingsContext.Provider>
      </>
    );
    if (onTablet) {
      return (
        <Dialog>
          <DialogTrigger asChild><ConsoleButton /></DialogTrigger>
          <DialogContent
            showCloseButton={false}
            className="flex h-[min(620px,85dvh)] w-[min(540px,calc(100%-40px))] max-w-none flex-col gap-0 overflow-hidden bg-card p-0 text-card-foreground"
            data-testid="console-sheet"
          >
            {content}
          </DialogContent>
        </Dialog>
      );
    }
    if (onPhone && edge === "bottom") {
      return (
        <BottomSheet>
          <BottomSheetTrigger asChild><ConsoleButton /></BottomSheetTrigger>
          <BottomSheetContent
            className="h-[85dvh] gap-0 bg-card text-card-foreground data-[vaul-drawer-direction=bottom]:max-h-none"
            data-testid="console-sheet"
          >
            {content}
          </BottomSheetContent>
        </BottomSheet>
      );
    }
    return (
      <Sheet>
        <SheetTrigger asChild><ConsoleButton /></SheetTrigger>
        <SheetContent
          side={edge}
          className={edge === "top"
            ? "max-h-[85dvh] gap-0 p-0 pt-[env(safe-area-inset-top)]"
            : "gap-0 p-0 pb-[env(safe-area-inset-bottom)] data-[side=bottom]:h-[85dvh]"}
          showCloseButton={false} data-testid="console-sheet"
        >
          {content}
        </SheetContent>
      </Sheet>
    );
  };

  return (
    // The fallback is the page's own background rather than a spinner:
    // it is on screen for one request, and a flash of "loading" where
    // a chart is about to be is worse than a moment of nothing.
    <Suspense fallback={<div className="h-dvh w-full bg-background" />}>
    <Workspace dep={dep} dest={dest} panel={panel} setPanel={setPanel}>
      {pieces => (
        <div
          // Pinned to the viewport rather than sized to it (`h-dvh`): a
          // page that can scroll at all, iOS Safari scrolls for its own
          // reasons -- turned to landscape and back, it was left scrolled
          // by the height of the toolbar it had collapsed. Pinned, there
          // is nothing to scroll; the panel and the consoles scroll inside
          // themselves. On paper the panel flows as a document.
          className="fixed inset-0 overflow-hidden print:static print:overflow-visible"
          // The navigation bar's edge, for index.css's `nav-bottom`
          // variant: "auto" until one is picked, the bottom on a phone.
          data-nav={navBar ?? "auto"}
          data-mode={mode}
        >
          {/* React hoists a rendered <title> into the document head
              itself, so the browser tab says which page this is
              without an effect writing document.title by hand. */}
          <title>{title}</title>
          {/* An emailed sign-in link lands here (#signin=…) and is
              finished in the app's own dialog. */}
          <LinkSignIn />
          {/* Dev mode's refusal: someone it is not for, on the dev page,
              is taken to the map (the switch itself is in the settings). */}
          <DevGuard />
          {/* For a keyboard: past the panel to the map in one press.
              Visible only while it has focus. */}
          <a
            href="#content"
            className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm shadow outline-none focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Skip to the map
          </a>
          {/* `isolate`: Leaflet's own panes and controls carry z-indexes
              up to 1000; contained here, the map is one flat layer under
              the panel and the sheets. The insets as variables, for the
              chart credit (index.css). */}
          <main
            id="content"
            className="absolute inset-0 isolate print:hidden"
            style={{
              "--map-inset-top": `${insets.top}px`,
              "--map-inset-bottom": `${insets.bottom}px`,
              "--map-inset-left": `${insets.left}px`,
            } as CSSProperties}
          >
            <MapInsetsContext.Provider value={insets}>
              <MapButtonsContext.Provider value={consoleOf(pieces)}>
                {pieces.map}
              </MapButtonsContext.Provider>
            </MapInsetsContext.Provider>
          </main>
          <MapPanel
            label={panelLabel} controls={pieces.controls}
            state={panel} onStateChange={setPanel} onInsetsChange={changeInsets}
            notices={pieces.notices}
            top={(
              <>
                <div className="min-w-0 flex-1">
                  <RouteForm
                    dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest}
                    onSubmit={pieces.submit} disabled={pieces.loading}
                  />
                </div>
                {pieces.actions && <div className="flex shrink-0 items-center">{pieces.actions}</div>}
              </>
            )}
          >
            {pieces.sidebar}
          </MapPanel>
        </div>
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
