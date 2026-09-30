import type { CSSProperties } from "react";
import { Toaster } from "./ui/sonner";
import { useIsMobile } from "../hooks/use-mobile";

/**
 * The app's one Toaster -- PageStatus's progress line (across every page
 * that has one) renders through it via toast.loading/dismiss, rather
 * than each page mounting its own floating status element.
 *
 * Bottom-centre from `md` up, and top-centre on a phone, where the
 * header and the map's buttons are the bottom of the screen: a toast
 * there covered them, and at the top it comes in as an iOS banner does,
 * over the map and clear of a sheet (they stop at 85% of the height).
 * closeButton: off by default in sonner, but the error toast sets
 * `duration: Infinity` (see usePageStatus) -- with no close button, the
 * only way to dismiss it is for the error condition to clear itself in
 * app state, and a pilot has no way to just get it off their screen
 * while that's still true. richColors: every icon here
 * (success/info/warning/error) is drawn with `fill="currentColor"` in
 * sonner's own source, so without this they're all the same neutral
 * text color -- error and warning only actually READ as red/amber,
 * distinct from a plain status toast, once this is on. Colors the
 * toast's own background/border along with the icon (sonner's one
 * built-in switch for both, not two separate settings).
 */
export default function AppToaster() {
  const onPhone = useIsMobile();
  return (
    <Toaster
      position={onPhone ? "top-center" : "bottom-center"}
      closeButton
      richColors
      style={{ "--width": "min(34rem, calc(100vw - 2rem))" } as CSSProperties}
      expand={false}
      visibleToasts={3}
      // Under the notch or the Dynamic Island, where there is one.
      mobileOffset={{ top: "max(1rem, calc(env(safe-area-inset-top) + 0.5rem))", left: "1rem", right: "1rem" }}
      // A toast still on screen ("VFR flight not recommended") was
      // printing over the briefing's table; the paper is the
      // briefing alone.
      className="print:hidden"
      // A viewport position, not a map-area one, so an open drawer (a
      // full-screen Sheet on a phone) sits under it rather than beside
      // it. sonner's own swipe-to-dismiss removed a toast on the same
      // touch that was meant to tap it, and once removed mid-touch the
      // browser's own click lands on whatever the drawer had underneath
      // -- an accordion trigger, most often -- which is how tapping a
      // toast could expand a briefing section that was never touched.
      // `closeButton` above is already the deliberate way to dismiss one
      // by hand.
      swipeDirections={[]}
    />
  );
}
