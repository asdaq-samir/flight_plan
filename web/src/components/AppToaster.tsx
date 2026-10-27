import type { CSSProperties } from "react";
import { Check } from "lucide-react";
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
 * Only news that goes by itself -- progress, "Link Copied", "Airplane
 * Added" -- so no close button, as iOS's banners have none: what went
 * wrong is said where it belongs (lib/problems), not in a toast that
 * stayed until closed. Apple Maps' banner, at the owner's ask (the toast
 * rewrite, 2026-10-27): a frosted capsule with a tick in the tint where
 * it was a green card, two seconds of it, the words a short title.
 */
export default function AppToaster() {
  const edge = useNavEdge();
  return (
    <Toaster
      position={edge === "bottom" ? "top-center" : "bottom-center"}
      duration={2000}
      icons={{ success: <Check className="size-4 text-tint" strokeWidth={2.5} aria-hidden /> }}
      // The app's one radius for what floats (index.css), over sonner's 8.
      style={{ "--width": edge === "top" ? "min(34rem, calc(100vw - 8.5rem))" : "min(34rem, calc(100vw - 2rem))", "--border-radius": "var(--radius)" } as CSSProperties}
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
        // With the sheet at the top, the toast comes up from the foot,
        // where the map's buttons stand on both sides (the food button at
        // the left, the column at the right): between them, not over
        // them, where it covered Full Screen and Fly-in Food (a check of
        // the Top layout on the phone, 2026-10-27). 44 points of button,
        // its margin and a little air each side.
        left: edge === "top" ? "4.25rem" : "1rem", right: edge === "top" ? "4.25rem" : "1rem",
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
