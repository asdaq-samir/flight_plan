import { useSyncExternalStore } from "react";

/**
 * The window's height and its safe-area insets, as numbers for the
 * components that need them in JavaScript -- the map panel's sheet,
 * whose detents vaul takes in pixels -- where everything else reads
 * them in CSS (`env(safe-area-inset-*)`, `dvh`).
 *
 * The insets come from a probe: an invisible element padded by
 * `env()`, read back through its computed style, since there is no
 * other way to ask the browser for them. Both are re-read on a resize,
 * which is also what turning a phone fires.
 */
/** A reading of the window, taken once and again only when one of its
 *  events says it has changed -- not at every render of every component
 *  that asks (useSyncExternalStore's getSnapshot): the insets' read is a
 *  computed style, and asked for at every render it brought the whole
 *  page's styles up to date each time, 0.4 s of a phone's as a new route
 *  drew (measured 2026-10-07). */
function held<T>(read: () => T, events: (onChange: () => void) => () => void) {
  let value: T | undefined;
  let fresh = false;
  // Its own listener, for good and ahead of any component's: a change
  // while nothing was listening is still a change.
  let watching = false;
  const watch = () => {
    if (watching) return;
    watching = true;
    events(() => { fresh = false; });
  };
  return {
    subscribe: (onChange: () => void) => {
      watch();
      return events(onChange);
    },
    get: (): T => {
      watch();
      if (!fresh) {
        value = read();
        fresh = true;
      }
      return value as T;
    },
  };
}

const onResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

let probe: HTMLDivElement | null = null;

function readInsets(): string {
  if (!probe) {
    probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;"
      + "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
  }
  const style = getComputedStyle(probe);
  return `${style.paddingTop}|${style.paddingBottom}`;
}

const insets = held(readInsets, onResize);
const windowHeight = held(() => window.innerHeight, onResize);

export function useSafeArea(): { top: number; bottom: number } {
  const [top = 0, bottom = 0] = useSyncExternalStore(insets.subscribe, insets.get, () => "0px|0px").split("|").map(v => parseFloat(v) || 0);
  return { top, bottom };
}

export function useWindowHeight(): number {
  return useSyncExternalStore(windowHeight.subscribe, windowHeight.get, () => 800);
}

/** The visual viewport, which shrinks when the on-screen keyboard
 *  comes up (iOS leaves the layout viewport, and so `fixed` things,
 *  where they were), and moves as Safari scrolls the page to the
 *  focused field. */
const onVisual = (onChange: () => void) => {
  const visual = window.visualViewport;
  window.addEventListener("resize", onChange);
  visual?.addEventListener("resize", onChange);
  visual?.addEventListener("scroll", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    visual?.removeEventListener("resize", onChange);
    visual?.removeEventListener("scroll", onChange);
  };
};

const keyboardInset = held(() => {
  const visual = window.visualViewport;
  return visual ? Math.max(0, Math.round(window.innerHeight - visual.height - visual.offsetTop)) : 0;
}, onVisual);
const visualHeight = held(() => Math.round(window.visualViewport?.height ?? window.innerHeight), onVisual);

/** How much of the bottom of the window the on-screen keyboard covers:
 *  0 with no keyboard, and where the browser shrinks the window for one
 *  instead (Chrome on Android), since the window's own height says it. */
export function useKeyboardInset(): number {
  return useSyncExternalStore(keyboardInset.subscribe, keyboardInset.get, () => 0);
}

/** How tall the part of the page in sight is: the window's height, less
 *  the on-screen keyboard while it is up. */
export function useVisualHeight(): number {
  return useSyncExternalStore(visualHeight.subscribe, visualHeight.get, () => 800);
}
