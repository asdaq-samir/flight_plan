import { closeTopCard } from "./openCards";

/**
 * A device's own Back -- Android's gesture or button, a TV remote's --
 * on the site: what Escape does, the topmost thing closed, a menu, a
 * dialog, the layers (each takes the key and says so, preventDefault), else the
 * top card closed (an airport's, Nearest's: lib/openCards), else the
 * panel lowered (its own Escape, MapPanel). Answers whether anything was
 * open to close; with nothing, the caller puts the app away. Not the web
 * view's history: the planner keeps its state in the address with each
 * change replacing the last, so going back would leave the app, or land
 * on a spent sign-in link.
 */
export function closeTopmost(): boolean {
  if (escapeAt(document.activeElement ?? document.body)) return true;
  if (closeTopCard()) return true;
  const panel = document.querySelector<HTMLElement>('[data-slot="map-panel"]');
  if (panel && panel.dataset.panel !== "peek") {
    escapeAt(panel);
    return true;
  }
  return false;
}

/** Escape pressed at an element: whether anything took it. */
function escapeAt(target: Element): boolean {
  const key = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(key);
  return key.defaultPrevented;
}
