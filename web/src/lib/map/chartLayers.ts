import { useSyncExternalStore } from "react";

/**
 * Which charts the map draws: the base chart (the sectional, or one of
 * the IFR enroute charts) and whether the terminal area chart is
 * pinned over it (`tac`), drawn at every zoom it exists at -- set
 * from the pin the map offers over a terminal area (`OverlayPin`) or
 * the info popover's checkbox. One setting for both map pages,
 * remembered per browser.
 *
 * A tiny store rather than React state because the thing that acts on
 * it is Leaflet, which lives outside React (`createBasemaps` subscribes
 * and swaps its layers), and the thing that sets it is the info
 * popover on each page. Routing it through PlanView's and LabelView's
 * own state would mean threading two values through two pages, two
 * maps and two popovers for a preference that is about the map and
 * nothing else on the page.
 *
 * localStorage is a convenience only: unavailable (a private window,
 * blocked site data) the map simply starts on the sectional each visit.
 */
export type BaseChart = "sec" | "ifr_low" | "ifr_high";

export const BASE_CHARTS: { kind: BaseChart; label: string }[] = [
  { kind: "sec", label: "Sectional" },
  { kind: "ifr_low", label: "IFR low" },
  { kind: "ifr_high", label: "IFR high" },
];

const BASE_KEY = "vfr.base";
// "vfr.pinned", not the "vfr.tac" this setting was stored under when it
// meant "draw the TAC as soon as it can be drawn": a browser that had
// that on would otherwise start with the terminal chart pinned, which
// is exactly the chart appearing unasked that the pin exists to end.
const TAC_KEY = "vfr.pinned";
const listeners = new Set<() => void>();

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

let state = {
  base: read<BaseChart>(BASE_KEY, BASE_CHARTS.map(b => b.kind), "sec"),
  tac: read(TAC_KEY, ["0", "1"], "0") === "1",
};

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // per-browser convenience only; nothing to do without it
  }
}

function notify() {
  listeners.forEach(listener => listener());
}

export const chartLayers = {
  get: () => state,
  setBase(base: BaseChart) {
    state = { ...state, base };
    write(BASE_KEY, base);
    notify();
  },
  setTac(tac: boolean) {
    state = { ...state, tac };
    write(TAC_KEY, tac ? "1" : "0");
    notify();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

const SERVER_DEFAULT = { base: "sec" as BaseChart, tac: false };

export function useChartLayers() {
  return useSyncExternalStore(chartLayers.subscribe, chartLayers.get, () => SERVER_DEFAULT);
}
