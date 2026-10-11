import type { Metric } from "web-vitals";
import type { SpeedFieldReport } from "./api/types";

/**
 * How fast the page is on this pilot's device, sent to the server
 * (SpeedController) for the trend in the developer console's Speed page:
 * Google's Core Web Vitals -- LCP, INP, CLS -- and FCP and TTFB, measured
 * by Google's own web-vitals library (web.dev/articles/vitals), with the
 * page, the kind of device and the build.
 *
 * Nothing of the pilot's goes: no account, no address, no route, no
 * position (docs/privacy-inventory.md). Sent with sendBeacon as the page is
 * put away -- when INP and CLS are final -- which outlives the page and
 * carries no credentials; again only if something changed since.
 *
 * The library loads once the page is idle, outside the first script: its
 * observers ask for what was measured before them (buffered), so starting
 * late loses nothing. Not in a browser driven by tests (navigator.webdriver),
 * whose runs on a busy machine would only blur the trend.
 */
export function startSpeedReports(win: Window = window) {
  if (win.navigator.webdriver) return;
  const idle = win.requestIdleCallback ?? ((go: () => void) => win.setTimeout(go, 3000));
  idle(() => {
    void import("web-vitals").then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
      const pending: Record<string, number> = {};
      const keep = (metric: Metric) => { pending[metric.name] = metric.value; };
      for (const on of [onCLS, onFCP, onINP, onLCP, onTTFB]) on(keep);
      // After the library's own listeners, which are added as each onX
      // is called and give their final values as the page is hidden.
      const flush = () => {
        if (win.document.visibilityState !== "hidden" || Object.keys(pending).length === 0) return;
        const report = reportOf(pending, win);
        for (const name of Object.keys(pending)) delete pending[name];
        if (typeof win.navigator.sendBeacon === "function") {
          win.navigator.sendBeacon("/api/speed/field", new Blob([JSON.stringify(report)], { type: "application/json" }));
        }
      };
      win.document.addEventListener("visibilitychange", flush);
    });
  });
}

/** The report for what has been measured: rounded, a millisecond (CLS to
 *  a thousandth), as the server takes them. */
export function reportOf(values: Record<string, number>, win: Window = window): SpeedFieldReport {
  const metrics: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    metrics[name] = name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
  }
  return { page: pageOf(win.location.pathname), device: deviceOf(win), version: versionOf(win.document), metrics };
}

/** The page by its first part under /app: "plan", "train", or "other". */
export function pageOf(path: string): string {
  const part = /^\/app\/([a-z][a-z0-9-]{0,39})/.exec(path)?.[1];
  return part ?? "other";
}

/** An iPad-sized touch screen, as use-tablet.ts decides it. */
const TABLET = "(pointer: coarse) and (min-width: 744px) and (min-height: 600px)";

/** The kind of device by its pointer and its screen: a touch screen is a
 *  phone unless it is a tablet's size; a mouse is a desktop. */
export function deviceOf(win: Window): "phone" | "tablet" | "desktop" {
  if (win.matchMedia(TABLET).matches) return "tablet";
  return win.matchMedia("(pointer: coarse)").matches ? "phone" : "desktop";
}

/** The build, by the hash in its first script's name (index-<hash>.js),
 *  which changes with every build that changes the app; "dev" for vite's
 *  own server, which has none. */
export function versionOf(doc: Document): string {
  const src = doc.querySelector<HTMLScriptElement>("script[type=module][src*='/assets/index-']")?.src ?? "";
  return /\/assets\/index-([A-Za-z0-9_-]{1,40})\.js/.exec(src)?.[1] ?? "dev";
}
