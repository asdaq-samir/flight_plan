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
const subscribe = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

let probe: HTMLDivElement | null = null;

function insets(): string {
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

export function useSafeArea(): { top: number; bottom: number } {
  const [top = 0, bottom = 0] = useSyncExternalStore(subscribe, insets, () => "0px|0px").split("|").map(v => parseFloat(v) || 0);
  return { top, bottom };
}

export function useWindowHeight(): number {
  return useSyncExternalStore(subscribe, () => window.innerHeight, () => 800);
}

/** The visual viewport, which shrinks when the on-screen keyboard
 *  comes up (iOS leaves the layout viewport, and so `fixed` things,
 *  where they were), and moves as Safari scrolls the page to the
 *  focused field. */
const subscribeVisual = (onChange: () => void) => {
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

/** How much of the bottom of the window the on-screen keyboard covers:
 *  0 with no keyboard, and where the browser shrinks the window for one
 *  instead (Chrome on Android), since the window's own height says it. */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeVisual, () => {
    const visual = window.visualViewport;
    return visual ? Math.max(0, Math.round(window.innerHeight - visual.height - visual.offsetTop)) : 0;
  }, () => 0);
}
