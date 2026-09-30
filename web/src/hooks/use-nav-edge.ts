import { useIsMobile } from "./use-mobile";
import { usePreferences, type NavEdge } from "../lib/preferences";

/**
 * The screen edge the header is on: the one picked in the map's
 * settings, or until one is, the bottom on a phone -- where a thumb
 * reaches it, as iOS puts a toolbar -- and the top from `md` up. The
 * map's buttons sit on the same edge, and on a phone the consoles and
 * every panel come in from it; the toasts take the other one.
 *
 * The styling that follows it is CSS (index.css's `nav-bottom`
 * variant, keyed on the page's `data-nav`), which knows a phone from
 * the first frame; this is for what the stock components take as a
 * prop -- a sheet's side, a drawer's direction, the toaster's corner.
 */
export function useNavEdge(): NavEdge {
  const chosen = usePreferences(s => s.navBar);
  const onPhone = useIsMobile();
  return chosen ?? (onPhone ? "bottom" : "top");
}
