import { closeTopmost } from "./back";

/**
 * The TV apps (tv/: Samsung's Tizen and LG's webOS): the site in the
 * TV's own web engine, opened by each app's page with `?tv=` and its
 * platform, driven by a remote's arrows, OK and Back rather than a
 * finger or a mouse. The planner rewrites its address with each change,
 * so the platform is kept for the visit; a TV's own browser is known by
 * its agent.
 */
export type TvPlatform = "tizen" | "webos";

const KEY = "vfr.tv";

/** Which TV this page is on, or null off one. */
export function tvPlatform(): TvPlatform | null {
  try {
    const asked = new URLSearchParams(window.location.search).get("tv");
    if (asked === "tizen" || asked === "webos") sessionStorage.setItem(KEY, asked);
    const kept = sessionStorage.getItem(KEY);
    if (kept === "tizen" || kept === "webos") return kept;
  } catch {
    // No storage (a private window): the agent alone says.
  }
  const agent = navigator.userAgent;
  if (/Tizen/i.test(agent) && /SMART-TV|SmartTV/i.test(agent)) return "tizen";
  if (/Web0S|webOS/i.test(agent) && /SmartTV|SMART-TV/i.test(agent)) return "webos";
  return null;
}

/** The remotes' Back: Samsung's Return (10009, "XF86Back") and LG's Back
 *  (461, "GoBack"), as their makers' guides give them. */
const isBack = (event: KeyboardEvent) =>
  event.keyCode === 10009 || event.keyCode === 461 || event.key === "XF86Back" || event.key === "GoBack" || event.key === "BrowserBack";

/** The keys that zoom the map in and out where a remote has no + and -:
 *  OK on the map, and a channel up and down (LG sends them as PageUp and
 *  PageDown; Samsung's ChannelUp and ChannelDown are 427 and 428). */
export const zoomInKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === "PageUp" || event.key === "ChannelUp" || event.keyCode === 427;
export const zoomOutKey = (event: KeyboardEvent) =>
  event.key === "PageDown" || event.key === "ChannelDown" || event.keyCode === 428;

/** Whether the remote is on the map: Leaflet's container focused. */
function onMap(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.classList.contains("leaflet-container");
}

const DIRECTIONS: Record<string, "left" | "up" | "right" | "down"> = {
  ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down",
};

/** An arrow moving the focus, as the polyfill's own handler does: not
 *  one a control took first (a menu, a slider, the map), and in a field
 *  only from its ends, its caret moving inside it. */
function arrow(event: KeyboardEvent) {
  const direction = DIRECTIONS[event.key];
  if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const field = document.activeElement;
  if (field instanceof HTMLTextAreaElement) return;
  if (field instanceof HTMLInputElement && field.selectionStart !== null) {
    const { selectionStart: at, selectionEnd: end, value } = field;
    if (direction === "left" && (at !== 0 || end !== 0)) return;
    if (direction === "right" && (at !== value.length || end !== value.length)) return;
  }
  event.preventDefault();
  (window as { navigate?: (direction: string) => void }).navigate?.(direction);
}

/** The app put away: LG's own exit (webOS 6 and later ask first), else
 *  the window closed, which a TV's runtime takes as leaving the app. */
function leave(platform: TvPlatform) {
  const tizen = (window as { tizen?: { application?: { getCurrentApplication?: () => { exit: () => void } } } }).tizen;
  const webOS = (window as { webOS?: { platformBack?: () => void } }).webOS;
  if (platform === "tizen" && tizen?.application?.getCurrentApplication) tizen.application.getCurrentApplication().exit();
  else if (platform === "webos" && webOS?.platformBack) webOS.platformBack();
  else window.close();
}

/**
 * The page made for a TV, before the first render: the page drawn as at
 * 1280 by 720, half again as large on a 1920 screen to be read from the
 * sofa (LG's app asks the same of webOS in its appinfo.json); the
 * remote's arrows moving from control to control by where they are on
 * the screen (the W3C's spatial navigation, by its polyfill); its Back
 * closing what is open, as Escape does (lib/back), then leaving the app.
 * On the map the arrows pan it and OK and a channel up and down zoom it
 * (MapShell, TvMapKeys), and Back takes the remote off it.
 */
export function startTv(platform: TvPlatform) {
  document.documentElement.dataset.tv = platform;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) viewport.content = "width=1280, initial-scale=1, user-scalable=no";
  void import("spatial-navigation-polyfill").then(() => {
    // The polyfill starts hearing the arrows at the page's load; brought
    // in after it -- a chunk of its own, loaded only on a TV -- it never
    // would: the arrows are taken to its navigate() here instead.
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navigation || navigation.loadEventStart > 0) window.addEventListener("keydown", arrow);
  });
  // The remote on the panel's first control as the page comes up, not on
  // nothing: the arrows' first move from nothing chose the map, the
  // largest thing there, where they pan it rather than move on.
  const started = Date.now();
  const timer = window.setInterval(() => {
    const first = document.querySelector<HTMLElement>('[data-slot="map-panel"] button:not([disabled])');
    if (document.activeElement && document.activeElement !== document.body) window.clearInterval(timer);
    else if (first) {
      first.focus();
      window.clearInterval(timer);
    } else if (Date.now() - started > 15_000) window.clearInterval(timer);
  }, 250);
  // Capture: ahead of the page's own Escape handling, which a Back is not.
  window.addEventListener("keydown", event => {
    if (!isBack(event)) return;
    event.preventDefault();
    // Off the map first, to the panel's first control (or the page's), so
    // the arrows move between controls again.
    if (onMap()) {
      const next = document.querySelector<HTMLElement>('[data-slot="map-panel"] button, [data-slot="map-panel"] input, button');
      (next ?? document.body).focus();
      return;
    }
    if (!closeTopmost()) leave(platform);
  }, true);
}
