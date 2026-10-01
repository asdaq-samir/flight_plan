/** iOS's Body text style at the default text size, in points. */
const BODY_PT = 17;
/** The smallest Body the app follows down to: iOS's Small. Below it the
 *  app's 13-point notes would fall under Apple's 11-point floor, where
 *  iOS's own footnotes stop shrinking. */
const SMALLEST_BODY_PT = 15;
/** The narrowest layout the app is built for, in rem: a 320-point Slide
 *  Over at the default size. The text grows only as far as the screen
 *  still holds this many rem across. */
const NARROWEST_REM = 20;

/** Whether this is Safari on an iPhone or an iPad (which says it is a
 *  Mac, with a touch screen): where the system text size is the
 *  reader's, set in Settings, Display & Text Size. */
function onIOS(): boolean {
  return navigator.maxTouchPoints > 1 && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

/** The root size for a Body style of `bodyPx`, kept to what `width`
 *  can hold: 16 at the default, and in step with the reader's size. */
export function rootSize(bodyPx: number, width: number): number {
  return Math.min((Math.max(bodyPx, SMALLEST_BODY_PT) * 16) / BODY_PT, width / NARROWEST_REM);
}

/**
 * The text size the reader picked on their iPhone, followed: Safari
 * resolves `-apple-system-body` to the Body style at the size set in
 * Settings (17 at the default), as iOS's own apps follow Dynamic Type.
 * Every size in the app is in rem (lib/text.ts, Tailwind's spacing), so
 * the root's size scales all of it together -- the words and the rows
 * and padding round them -- while the 44-point hit areas, in pixels,
 * stay as they are. Capped where the screen would hold less than the
 * narrowest layout's width (NARROWEST_REM), past which the route row
 * runs under the buttons beside it: on an iPhone SE that is a step or
 * so above the default, on a Pro Max three.
 *
 * Elsewhere -- a Mac's Safari resolves the keyword to the Mac's 13, and
 * no other browser knows it -- the root stays the browser's own 16.
 * Measured again when the size could have changed: on a resize or a
 * turn, and when the page comes back from the background, which is
 * where the reader has been to Settings.
 */
export function followDynamicType(): void {
  if (!onIOS() || !CSS.supports("font", "-apple-system-body")) return;
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "font: -apple-system-body; position: absolute; visibility: hidden; pointer-events: none;";
  document.body.append(probe);
  const apply = () => {
    const body = parseFloat(getComputedStyle(probe).fontSize);
    if (!body) return;
    const root = rootSize(body, window.innerWidth);
    document.documentElement.style.fontSize = Math.abs(root - 16) < 0.1 ? "" : `${root.toFixed(2)}px`;
  };
  apply();
  window.addEventListener("resize", apply);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") apply(); });
}
