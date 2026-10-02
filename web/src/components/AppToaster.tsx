import type { CSSProperties } from "react";
import { Toaster } from "./ui/sonner";
import { useNavEdge } from "../hooks/use-nav-edge";

/**
 * The app's one Toaster -- PageStatus's progress line (across every page
 * that has one) renders through it via toast.loading/dismiss, rather
 * than each page mounting its own floating status element.
 *
 * On the edge away from the header (useNavEdge): bottom-centre under a
 * header at the top, and top-centre over one at the bottom. From the top
 * it comes in as an iOS banner does, over the map and clear of a sheet
 * from the bottom (they stop at 85% of the height) -- and, on a phone,
 * across the map's buttons from either edge, the location arrow under it
 * still taking a tap (a toast takes none but its controls', index.css).
 * It stopped short of them at the top while Settings was among them.
 *
 * Only news that goes by itself -- progress, "Link copied", "Aircraft
 * added" -- so no close button, as iOS's banners have none: what went
 * wrong is said where it belongs (lib/problems), not in a toast that
 * stayed until closed. richColors: a success's tick reads green.
 */
export default function AppToaster() {
  const edge = useNavEdge();
  return (
    <Toaster
      position={edge === "bottom" ? "top-center" : "bottom-center"}
      richColors
      // The app's one radius for what floats (index.css), over sonner's 8.
      style={{ "--width": "min(34rem, calc(100vw - 2rem))", "--border-radius": "var(--radius)" } as CSSProperties}
      expand={false}
      visibleToasts={3}
      // Under the notch or the Dynamic Island, or over the home
      // indicator, where there is one.
      mobileOffset={{
        // Level with the map's buttons (MapControls), at the same distance
        // under the status bar, and across them from either edge, as at
        // the bottom: it stopped short of them at the top while Settings
        // was among them, which is on the search bar now, and a toast
        // takes no tap but its own controls' (index.css).
        top: "max(0.5rem, env(safe-area-inset-top))", bottom: "max(1rem, env(safe-area-inset-bottom))",
        left: "1rem", right: "1rem",
      }}
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
      // Each goes by itself in a few seconds.
      swipeDirections={[]}
    />
  );
}
