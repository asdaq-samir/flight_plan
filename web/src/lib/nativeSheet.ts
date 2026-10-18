/**
 * The iOS app's own sheet for the map's panel (web/ios's NativeSheet.swift),
 * as Apple Maps' sheet is, at the owner's ask ("I want the bottom sheet to
 * be iOS native sheet so that it works like Apple Maps", 2026-10-18): iOS
 * moves the sheet -- its detents, drag, flick and glass -- and the site
 * draws what is in it. The site runs in two web views: the app's own draws
 * the map alone (role "map"), and one in the sheet draws the panel alone
 * (role "sheet"). The app says which before any script runs
 * (`window.WingtipNativeRole`); in Safari, on Android and in an app from
 * before the sheet there is no role, and the page is the one view it was.
 *
 * Kept in step: the address, which holds the route and what is picked on
 * it, handed from either page to the other; the sheet's size, its pill,
 * half way and all the way up, which is the panel's own in the sheet, and
 * its height on the map, for the map to fit a route clear of it.
 */
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { PanelState } from "../components/mapChrome";

export type NativeRole = "map" | "sheet";
type Detent = "pill" | "medium" | "large";

/** Which of the two web views this page is, or null as the one page. */
export const nativeRole: NativeRole | null = (() => {
  const role = (window as { WingtipNativeRole?: string }).WingtipNativeRole;
  return role === "map" || role === "sheet" ? role : null;
})();

const PANEL_OF: Record<Detent, PanelState> = { pill: "peek", medium: "half", large: "full" };
const DETENT_OF: Record<PanelState, Detent> = { peek: "pill", half: "medium", full: "large" };

interface Listener { remove: () => Promise<void> }

/** The tabs as the sheet's own bar draws them (NativeSheet.swift's
 *  SheetContainerViewController): each tab, the one up, a card's bar in
 *  their place while one is open over the tab (its name, Back and the
 *  close), and a tab's mark. */
export interface NativeTabs {
  tabs: { value: string; label: string }[];
  up: string;
  card: { title: string; back: boolean; close: boolean } | null;
  marks: Record<string, "stop" | "caution">;
}
type TabAction = { action: "tap"; tab: string } | { action: "back" | "close" | "show" };

interface NativeSheetPlugin {
  ready(): Promise<{ role: string }>;
  syncUrl(options: { search: string }): Promise<void>;
  setDetent(options: { detent: Detent }): Promise<void>;
  setTabs(options: NativeTabs): Promise<void>;
  cover(options: { hidden: boolean }): Promise<void>;
  addListener(event: "url", listener: (change: { search: string }) => void): Promise<Listener>;
  addListener(event: "detent", listener: (change: { detent: Detent; height: number }) => void): Promise<Listener>;
  addListener(event: "tabAction", listener: (action: TabAction) => void): Promise<Listener>;
}

/** The plugin, once, in the app's two web views; none elsewhere, where
 *  its package is never loaded. */
const plugin: Promise<NativeSheetPlugin> | null = nativeRole
  ? import("@capacitor/core").then(({ registerPlugin }) => registerPlugin<NativeSheetPlugin>("NativeSheet"))
  : null;

/**
 * The page's side of the native sheet, on the map's page (MapPage): its
 * address to the other page as it changes and the other's taken in; in
 * the sheet, the panel's size from the sheet's and back; on the map, the
 * sheet's height (`onHeight`). Nothing as the one page.
 */
export function useNativeSheet({ panel, setPanel, onHeight }: {
  panel: PanelState;
  setPanel: (next: PanelState) => void;
  onHeight: (height: number, panel: PanelState) => void;
}) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const sheet = useRef<NativeSheetPlugin | null>(null);
  // The address last had from the other page, not sent back to it; and the
  // size last had from the sheet, not asked of it again.
  const fromOther = useRef<string | null>(null);
  const fromSheet = useRef<PanelState | null>(null);
  const handlers = useRef({ setPanel, onHeight });
  useEffect(() => {
    handlers.current = { setPanel, onHeight };
  }, [setPanel, onHeight]);
  const send = useCallback((now: string) => {
    if (now !== fromOther.current) void sheet.current?.syncUrl({ search: now }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!nativeRole) return;
    let gone = false;
    const listening: Listener[] = [];
    void (async () => {
      const native = await plugin!;
      listening.push(await native.addListener("url", ({ search: theirs }) => {
        if (theirs === window.location.search) return;
        fromOther.current = theirs;
        void navigate({ search: theirs }, { replace: true });
      }));
      listening.push(await native.addListener("detent", ({ detent, height }) => {
        if (nativeRole === "sheet") {
          fromSheet.current = PANEL_OF[detent];
          handlers.current.setPanel(PANEL_OF[detent]);
        } else {
          handlers.current.onHeight(height, PANEL_OF[detent]);
        }
      }));
      if (gone) return;
      sheet.current = native;
      await native.ready();
      // The map's page has the address the app opened on: the sheet's
      // starts from it.
      if (nativeRole === "map") send(window.location.search);
    })().catch(() => {});
    return () => {
      gone = true;
      for (const listener of listening) void listener.remove();
    };
  }, [navigate, send]);

  useEffect(() => {
    if (nativeRole) send(search);
  }, [search, send]);

  useEffect(() => {
    if (nativeRole !== "sheet" || panel === fromSheet.current) return;
    fromSheet.current = panel;
    void sheet.current?.setDetent({ detent: DETENT_OF[panel] }).catch(() => {});
  }, [panel]);
}

/**
 * The tab bar in Swift, in the sheet (the owner's "I also want the tabs
 * icon and selector to be in swift"): the page's TabBar, which keeps the
 * tabs' logic, says what the bar is to show (`state`, null outside the
 * sheet) and is told what was done on it -- a tab tapped, Back, the close,
 * the card's name tapped to show the tabs -- as a tap on its own would.
 */
export function useNativeTabs(state: NativeTabs | null, handlers: {
  tap: (tab: string) => void;
  back: () => void;
  close: () => void;
  show: () => void;
}) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const said = state ? JSON.stringify(state) : null;
  useEffect(() => {
    if (said) void plugin?.then(native => native.setTabs(JSON.parse(said) as NativeTabs)).catch(() => {});
  }, [said]);
  const on = state !== null;
  useEffect(() => {
    if (!on || !plugin) return;
    let gone = false;
    let listening: Listener | null = null;
    void plugin.then(async native => {
      const sub = await native.addListener("tabAction", done => {
        const h = latest.current;
        if (done.action === "tap") h.tap(done.tab);
        else h[done.action]();
      });
      if (gone) void sub.remove();
      else listening = sub;
    }).catch(() => {});
    return () => {
      gone = true;
      void listening?.remove();
    };
  }, [on]);
}

/** The map's page's own sheet out (a phone sheet over the map: its
 *  settings, a sheet from the map's controls): iOS's sheet, over the
 *  map's whole page, out of its way while it is, as it would otherwise
 *  cover it. Answers the way to bring it back. */
let away = 0;
export function holdNativeSheetAway(): () => void {
  if (nativeRole !== "map" || !plugin) return () => {};
  away += 1;
  if (away === 1) void plugin.then(native => native.cover({ hidden: true })).catch(() => {});
  return () => {
    away -= 1;
    if (away === 0) void plugin?.then(native => native.cover({ hidden: false })).catch(() => {});
  };
}
