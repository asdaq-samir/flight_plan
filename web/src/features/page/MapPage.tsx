import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { showError } from "../../lib/problems";
import { patched, useSearchParamsNow } from "../../lib/useSearchParamsNow";
import { cn } from "cn";
import { PagesShown } from "../../components/pagesShown";
import DevGuard from "../../components/DevGuard";
import MapPanel from "../../components/MapPanel";
import { ConsoleInPanelContext, ConsoleSettingsContext, useConsoleOpen, MapInsetsContext, NO_INSETS, type MapInsets, type PanelState } from "../../components/mapChrome";
import RouteForm from "../../components/RouteForm";
import { useNavEdge } from "../../hooks/use-nav-edge";
import { usePreferences } from "../../lib/preferences";
import { useWarmAirportIndex } from "../../lib/airportIndex";
import LinkSignIn from "../pilot/LinkSignIn";
import TvLink from "../pilot/TvLink";
import PlanWorkspace from "../plan/PlanWorkspace";
import type { WorkspacePieces } from "./workspace";
import { fromChunk } from "../../lib/fromChunk";

/** Setup's pill (the switches, the account), with the console's code
 *  rather than the page's first load: asked for once the page has drawn,
 *  with the settings (below), and drawn straight from the chunk then
 *  (fromChunk) -- under lazy() alone the first tap on Setup waited on it,
 *  an empty pill for a moment, at the owner's notice ("why is setup tab
 *  slow to load"). */

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
 *  reason: nothing on the map needs them until the console opens. Asked
 *  for once the page has drawn (MapPage), and drawn straight from the
 *  chunk then (fromChunk): opened on Settings, the console waited on it. */
const { Part: SettingsPanel, prefetch: prefetchSettings } = fromChunk(() => import("../../components/SettingsPanel"), m => m.default);

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

  // The settings' chunk, once the page has drawn (the console's own is
  // PlanWorkspace's to ask for).
  useEffect(() => {
    const later = window.setTimeout(() => { prefetchSettings(); }, 2000);
    return () => window.clearTimeout(later);
  }, []);

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
      return patched(prev, { signin: null });
    }, { replace: true });
  }, [refused, setSearchParams]);

  // How far the panel is out. All the way, on the planner, is the
  // address; resting is this page's own. Opened, the panel rests as its
  // pill (MapPanel).
  // An address that opens a list -- the Aircraft or Nearest list, Saved,
  // a tab's Favorites or Recents in full, a past flight's log -- opens all
  // the way up on it; a field's card, the
  // airspace at a point or an airplane half way, where every card opens,
  // as on 2026-10-11 (the owner's "pill to half to full worked really
  // well").
  const [localPanel, setLocalPanel] = useState<PanelState>(() => (
    mode !== "pilot" ? "peek"
      : ["place", "at", "flight"].some(key => searchParams.has(key)) ? "half"
        : ["past", "aircraft", "near", "saved", "list"].some(key => searchParams.has(key)) ? "full" : "peek"));
  // The airport index downloaded ahead of the first search, which at rest
  // is out of sight (lib/airportIndex).
  useWarmAirportIndex(mode === "pilot");
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
      return patched(prev, { view: next === "full" ? "briefing" : null });
    }, { replace: true, flushSync: true });
  }, [mode, briefingInAddress, setSearchParams]);
  // Landed on a list's address, all the way up, as its link asks (above):
  // the planner's all the way up is the address's (`view`), so said there
  // once.
  const landedFull = useRef(localPanel === "full" && !briefingInAddress);
  useEffect(() => {
    if (!landedFull.current) return;
    landedFull.current = false;
    setPanel("full");
  }, [setPanel]);

  // What the panel covers of the map at rest, for the map to fit a
  // route clear of it and lift its chart credit above it. Kept when it
  // has not changed, so a measurement that comes out the same does not
  // render the page again.
  const [insets, setInsets] = useState<MapInsets>(NO_INSETS);
  const changeInsets = useCallback((next: MapInsets) => {
    setInsets(prev => (prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left && prev.out === next.out && prev.up === next.up ? prev : next));
  }, []);

  // The console, Setup: its button the tab bar's last tab (TabBar), on both
  // pages, and what it opens a layer of the map's panel itself (below), as
  // an airport's card is: it pulls out as the route's sheet does -- the
  // pill and all the way -- dragged from anywhere on it. It was a sheet of
  // its own past a phone's width, and a form sheet on an iPad.
  // Out or not, the app's (useConsoleOpen): a developer's Pilot and
  // Developer in the console's title change the page under it, and the
  // console stays out, the other page's.
  const consoleOpen = useConsoleOpen(s => s.open);
  const setConsoleOpen = useConsoleOpen(s => s.setOpen);
  // The sheet is drawn once, with no trigger of its own: its button is the
  // tab bar's Settings (TabBar), opened from and given the focus back on
  // closing.
  const consoleButton = () => document.querySelector<HTMLElement>("[data-console-button]");
  // The layer put away: the one under it shows at the height the panel
  // is, and the focus goes back to the Settings tab it was opened from.
  const closeConsole = useCallback(() => {
    setConsoleOpen(false);
    // Once the tab bar's row is back over the panel's head.
    window.setTimeout(() => consoleButton()?.focus({ preventScroll: true }));
  }, [setConsoleOpen]);
  const consoleInPanel = useMemo(() => ({ close: closeConsole }), [closeConsole]);
  // Setup, the console, as a layer of the panel on every screen and both
  // pages -- a tab as the others are, at the owner's asks ("in landscape
  // mode it becomes a separate sheet while other tabs stay in the panel";
  // "redesign the dev similar way") -- where the panel's body is, the
  // route or the search under it kept (hidden) for when it is put away.
  // Named as the console it is; Escape puts it away, unless something
  // open in it (a menu) took the key.
  const consoleLayer = consoleOpen;
  // Its whole page drawn just after the frame that shows Setup's pill, in
  // the background (useDeferredValue's first value): the pill is what a tap
  // on Setup shows, the page under it only as the sheet comes up, and in
  // the same frame it held the pill back.
  const layerDrawn = useDeferredValue(consoleLayer, false);
  // Kept once drawn, as a tab's page is, at the owner's pick ("make Setup
  // an ordinary tab page"): put away, it is hidden rather than taken down,
  // and the next tap on Setup shows it at once -- where it was drawn anew
  // at each, a blank moment and then the page. Its own pages go back to
  // its list as it is put away (ConsolePages' PagesShown).
  const [setupDrawn, setSetupDrawn] = useState(false);
  if (layerDrawn && !setupDrawn) setSetupDrawn(true);
  const consoleLayerOf = (pieces: WorkspacePieces) => (
    <ConsoleInPanelContext.Provider value={consoleInPanel}>
      <ConsoleLayer label={consoleLabel} detent={panel === "full" ? "large" : "medium"} edge={edge} onClose={closeConsole} shown={consoleLayer}>
        <ConsoleSettingsContext.Provider value={<SettingsPanel />}>
          <PagesShown.Provider value={consoleLayer}>
            <AfterTheSheet>{pieces.console}</AfterTheSheet>
          </PagesShown.Provider>
        </ConsoleSettingsContext.Provider>
      </ConsoleLayer>
    </ConsoleInPanelContext.Provider>
  );

  // The panel's top row with it out: the workspace's head, or the route's
  // box or form and the actions beside it; none over a card alone or the
  // console's layer.
  const topRowOf = (pieces: WorkspacePieces) => pieces.alone || consoleLayer ? null : pieces.head ?? (
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
            );

  return (
    // The fallback is the page's own background rather than a spinner:
    // it is on screen for one request, and a flash of "loading" where
    // a chart is about to be is worse than a moment of nothing.
    <Suspense fallback={<div className="h-dvh w-full bg-background" />}>
    <Workspace dep={dep} dest={dest} panel={panel} setPanel={setPanel}>
      {pieces => {
        const topRow = topRowOf(pieces);
        return (
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
          <TvLink />
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
          <MapPanel
            label={consoleLayer ? consoleLabel : panelLabel} controls={pieces.alone || consoleLayer ? undefined : pieces.controls}
            state={panel} onStateChange={setPanel} onInsetsChange={changeInsets}
            // The pill: the workspace's own (a card's summary, the route's
            // one line), or else the top row itself -- the same element, so
            // a search bar typed into keeps its focus as the sheet comes up.
            // The console's layer (Setup) has none: at rest it is the tabs.
            compact={consoleLayer ? undefined : pieces.compact ?? topRow} toEdge={!!pieces.toEdge}
            // The tab bar over a card alone too, as iOS keeps its tab bar on
            // every screen: the tabs were gone while one was open. Setup has
            // no pill of its own: at rest it is the tabs, for the way back to
            // the others.
            bar={pieces.bar} layer={consoleLayer ? "console" : pieces.alone ? "card" : "tab"}
            foot={consoleLayer ? undefined : pieces.foot} footFills={!consoleLayer && !!pieces.footFills}
            cardOver={!!pieces.cardOver}
            top={topRow}
          >
            {setupDrawn && consoleLayerOf(pieces)}
            {/* Under the console while it is out, kept as it is. */}
            <div className={consoleLayer ? "hidden" : "contents"}>{pieces.sidebar}</div>
          </MapPanel>
        </div>
        );
      }}
    </Workspace>
    </Suspense>
  );
}

/**
 * Setup's page in the map's panel, a tab's body as the others' are: named
 * for the console it is (a region, no longer a dialog: the focus stays on
 * the tab picked, as it does for the others), hidden while another tab is
 * up, and Escape going back to the tab before it -- heard here, inside
 * the panel, before the panel hears it and lowers itself, and wherever
 * the focus has gone while it is up; not when a menu open in it took the
 * key first.
 */
function ConsoleLayer({ label, detent, edge, onClose, shown, children }: {
  label: string;
  detent: "medium" | "large";
  edge: "top" | "bottom";
  onClose: () => void;
  /** Setup the tab up: put away it is kept, hidden. */
  shown: boolean;
  children: ReactNode;
}) {
  const layer = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const node = layer.current;
    if (!node || !shown) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close.current();
    };
    // On the layer first, ahead of the panel's own Escape; on the document
    // too, for when a tap on the map or on the panel's bare parts has
    // taken the focus out (the layer is no modal), where the key would
    // otherwise be lost or lower the panel. A menu's own Escape has
    // already prevented the default by the time either hears it.
    node.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);
  return (
    <section
      ref={layer} aria-label={label}
      // Named for the suite only while it is up: put away it is there,
      // hidden, for the next tap on Setup.
      data-testid={shown ? "console-sheet" : undefined} data-detent={detent} data-edge={edge}
      className={cn("min-h-0 flex-1 flex-col print:hidden", shown ? "flex" : "hidden")}
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
