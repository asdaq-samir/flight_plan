import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { showError } from "../../lib/problems";
import { useSearchParamsNow } from "../../lib/useSearchParamsNow";
import DevGuard from "../../components/DevGuard";
import MapPanel from "../../components/MapPanel";
import { ConsoleButtonContext, ConsoleInPanelContext, ConsoleSettingsContext, useConsoleOpen, MapInsetsContext, NO_INSETS, type MapInsets, type PanelState } from "../../components/mapChrome";
import RouteForm from "../../components/RouteForm";
import SettingsButton from "../../components/SettingsButton";
import { Sheet, SheetContent } from "../../components/ui/sheet";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { useIsMobile } from "../../hooks/use-mobile";
import { useIsTablet } from "../../hooks/use-tablet";
import { useNavEdge } from "../../hooks/use-nav-edge";
import { usePreferences } from "../../lib/preferences";
import ConsoleHeader from "../pilot/ConsoleHeader";
import LinkSignIn from "../pilot/LinkSignIn";
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

/** The settings, the console's last tab, on their own chunk for the same
 *  reason: nothing on the map needs them until the console opens. */
const SettingsPanel = lazy(() => import("../../components/SettingsPanel"));

export type Mode = "pilot" | "dev";

/** What differs between the two pages: the words, the workspace, and
 *  the route to start on when the address names none (the planner
 *  asks the server for a collected one instead). */
const MODES = {
  pilot: {
    title: "Plan a route — Wingtip Maps", panel: "Flight Planning", console: "Pilot",
    Workspace: PlanWorkspace, route: ["", ""] as const,
  },
  dev: {
    title: "Dev — Wingtip Maps", panel: "Model Training", console: "Developer",
    Workspace: TrainWorkspace, route: ["C81", "KDLH"] as const,
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
  const { title, panel: panelLabel, console: consoleLabel, Workspace, route } = MODES[mode];
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
    showError(
      "That sign-in was refused",
      "The provider has not verified that account's email address. Verify it there, or sign in with an emailed link.",
    );
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("signin");
      return next;
    }, { replace: true });
  }, [refused, setSearchParams]);

  // How far the panel is out. All the way, on the planner, is the
  // address; half and resting are this page's own. The planner opened on
  // no route is Maps opened: half way up on the search bar, Favorites and
  // Recents under it (a reload forgets the route: lib/freshLoad).
  const [localPanel, setLocalPanel] = useState<PanelState>(
    () => (mode === "pilot" && !addressDep && !addressDest ? "half" : "peek"));
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
    setInsets(prev => (prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left && prev.out === next.out ? prev : next));
  }, []);

  // The console: its button (Settings, a gear, on both pages) and the
  // sheet it opens, with the settings as its last tab (ConsoleTabs) --
  // the pilot's account, airplanes, flights and guide, or the
  // developer's training, performance and system. Its button is on the
  // panel's capsule and nowhere else, as Maps' account is beside its
  // search: on the planner's search bar -- with a route on screen,
  // closing it brings the bar back -- and at the end of the training
  // page's route capsule. On a phone, a layer of the map's panel itself,
  // at the pilot's ask, as an airport's card is: it pulls out as the
  // route's sheet does -- the pill, the half every panel has and all the
  // way -- dragged from anywhere on it, and its close shows the layer
  // under it at the height it is; it was a sheet of its own over a dimmed
  // map (ConsoleSheet), half the screen, that slid away when lowered.
  // Elsewhere modal, so the page waits while it is out: a stock Sheet
  // from the navigation bar's edge (useNavEdge). Its
  // height is fixed rather than its content's: sized to the tab showing,
  // its edge rose and fell as the tabs changed, and the tab row moved out
  // from under the finger that had just tapped it. It opens half way, at
  // iOS's medium detent, and stays at whichever as the tabs change: it
  // opened all the way every time, a screen of nothing under one
  // airplane -- all the way, though, over a panel that is. On an iPad, iOS's form sheet instead: a card 540 by 620,
  // centred, as a sheet there is.
  // Out or not, the app's (useConsoleOpen): a developer's Pilot and
  // Developer in the console's title change the page under it, and the
  // console stays out, the other page's.
  const consoleOpen = useConsoleOpen(s => s.open);
  const setConsoleOpen = useConsoleOpen(s => s.setOpen);
  // The sheet is drawn once, with no trigger of its own: its button moves
  // between the search bar and the map's buttons, and is the one opened
  // from and given the focus back on closing.
  const consoleButton = useRef<HTMLButtonElement>(null);
  const openConsole = useCallback(() => {
    // In the panel on a phone: half way up from the pill (below), as a
    // card opens; where the panel is out already, at the height it is.
    setConsoleOpen(true);
  }, [setConsoleOpen]);
  // The layer put away: the one under it shows at the height the panel
  // is, and the focus goes back to the gear it was opened from.
  const closeConsole = useCallback(() => {
    setConsoleOpen(false);
    // Once the search bar it is on is back.
    window.setTimeout(() => consoleButton.current?.focus({ preventScroll: true }));
  }, [setConsoleOpen]);
  const consoleInPanel = useMemo(() => ({ close: closeConsole }), [closeConsole]);
  // Opened from anywhere -- the gear, or the training's retrain sending
  // the pilot to its progress -- the layer half way up from the pill on a
  // phone, as a card opens; lowered to the pill after, it stays there.
  const consoleWasOpen = useRef(consoleOpen);
  useEffect(() => {
    if (consoleOpen && !consoleWasOpen.current && onPhone && !onTablet && panel === "peek") setPanel("half");
    consoleWasOpen.current = consoleOpen;
  }, [consoleOpen, onPhone, onTablet, panel, setPanel]);
  const backToButton = useCallback((event: Event) => {
    event.preventDefault();
    consoleButton.current?.focus();
  }, []);
  // Round on a pane like the search field's, where Maps has the
  // account's picture.
  const settingsButton = (
    <SettingsButton
      ref={consoleButton} onClick={openConsole} aria-haspopup="dialog" aria-expanded={consoleOpen}
    />
  );
  const consoleOf = (pieces: WorkspacePieces) => {
    // The greeting, the way in or out and the close button on one row;
    // the console's content starts under it.
    const content = (
      <>
        <ConsoleHeader console={consoleLabel} />
        <ConsoleSettingsContext.Provider value={<SettingsPanel />}>
          <AfterTheSheet>{pieces.console}</AfterTheSheet>
        </ConsoleSettingsContext.Provider>
      </>
    );
    if (onTablet) {
      return (
        <Dialog open={consoleOpen} onOpenChange={setConsoleOpen}>
          <DialogContent
            showCloseButton={false} onCloseAutoFocus={backToButton}
            className="flex h-[min(620px,85dvh)] w-[min(540px,calc(100%-40px))] max-w-none flex-col gap-0 overflow-hidden bg-card p-0 text-card-foreground"
            data-testid="console-sheet"
          >
            {content}
          </DialogContent>
        </Dialog>
      );
    }
    // On a phone, in the panel (consoleLayerOf).
    if (onPhone) return null;
    return (
      <Sheet open={consoleOpen} onOpenChange={setConsoleOpen}>
        <SheetContent
          side={edge} onCloseAutoFocus={backToButton}
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

  // On a phone, the console as a layer of the panel: its header and tabs
  // where the panel's body is, the route or the search under it kept
  // (hidden) for when it is put away. Named as the console it is; Escape
  // puts it away, unless something open in it (a menu) took the key.
  const consoleLayer = onPhone && !onTablet && consoleOpen;
  const consoleLayerOf = (pieces: WorkspacePieces) => (
    <ConsoleInPanelContext.Provider value={consoleInPanel}>
      <ConsoleLayer label={consoleLabel} detent={panel === "full" ? "large" : "medium"} edge={edge} onClose={closeConsole}>
        <ConsoleHeader console={consoleLabel} />
        <ConsoleSettingsContext.Provider value={<SettingsPanel />}>
          <AfterTheSheet>{pieces.console}</AfterTheSheet>
        </ConsoleSettingsContext.Provider>
      </ConsoleLayer>
    </ConsoleInPanelContext.Provider>
  );

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
              Visible only while it has focus, so at a keyboard's 14
              (text-sm), outside the touch type scale. */}
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
              {pieces.map}
            </MapInsetsContext.Provider>
          </main>
          {consoleOf(pieces)}
          {/* On the planner's search bar, under the route's close with the
              panel out, and at the end of either page's route capsule. */}
          <ConsoleButtonContext.Provider value={settingsButton}>
          <MapPanel
            label={consoleLayer ? consoleLabel : panelLabel} controls={pieces.alone || consoleLayer ? undefined : pieces.controls}
            state={panel} onStateChange={setPanel} onInsetsChange={changeInsets}
            compact={pieces.compact}
            top={pieces.alone || consoleLayer ? null : pieces.head ?? (
              <>
                <div className="min-w-0 flex-1">
                  {pieces.route ?? (
                    <RouteForm
                      dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest}
                      onSubmit={pieces.submit} disabled={pieces.loading}
                    />
                  )}
                </div>
                {pieces.actions && <div className="flex shrink-0 items-center">{pieces.actions}</div>}
              </>
            )}
          >
            {consoleLayer && consoleLayerOf(pieces)}
            {/* Under the console while it is out, kept as it is. */}
            <div className={consoleLayer ? "hidden" : "contents"}>{pieces.sidebar}</div>
          </MapPanel>
          </ConsoleButtonContext.Provider>
        </div>
      )}
    </Workspace>
    </Suspense>
  );
}

/**
 * The console as a layer of the map's panel (a phone's): named as the
 * console it is, the focus taken into it as it opens, as the sheet took
 * it, and Escape putting it away -- heard here, inside the panel, before
 * the panel hears it and lowers itself; not when a menu open in it took
 * the key first.
 */
function ConsoleLayer({ label, detent, edge, onClose, children }: {
  label: string;
  detent: "medium" | "large";
  edge: "top" | "bottom";
  onClose: () => void;
  children: ReactNode;
}) {
  const layer = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const node = layer.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close.current();
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, []);
  return (
    <section
      ref={layer} role="dialog" aria-label={label} tabIndex={-1}
      data-testid="console-sheet" data-detent={detent} data-edge={edge}
      className="flex min-h-0 flex-1 flex-col outline-none print:hidden"
    >
      {children}
    </section>
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
  const placeholder = <div className="h-40" />;
  // The consoles' panels are lazy (PlanWorkspace's PilotPanel, the
  // settings): the same place held while one arrives.
  return drawn ? <Suspense fallback={placeholder}>{children}</Suspense> : placeholder;
}
