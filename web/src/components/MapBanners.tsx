import { lazy, Suspense } from "react";
import type { Map as GlMap } from "maplibre-gl";
import AircraftAlerts from "./AircraftAlerts";
import AlertsBanner from "./AlertsBanner";
import ProblemBanner from "./ProblemBanner";
import SunlightBanner from "./SunlightBanner";
import ZoomBanner from "./ZoomBanner";
import { useAtcRadio } from "../lib/atcRadio";
import { cn } from "cn";
import { useFlying } from "./mapChrome";

const RadioLayer = lazy(() => import("./RadioLayer"));

/**
 * The map's lines: at the top, the screen's width, over a panel at the
 * bottom (the map's buttons ride on the sheet, MapControls); beside the
 * buttons at the bottom otherwise --
 * what is ahead of own ship in the air (AlertsBanner) first, then an
 * airplane the pilot asked to be told of (AircraftAlerts), then what the
 * app could not do (ProblemBanner). Each its own glass, eight apart; the
 * column takes no taps of its own.
 *
 * Centred, as the toasts are (AppToaster), where they sat at the left:
 * the owner asked why an alert was not centred like "Planning Altitudes…"
 * (2026-10-27). At the foot it stands between the map's buttons on both
 * sides, the food button at the left and the column at the right, so it
 * no longer runs over the food button. Beside a sheet at the side (a
 * phone on its side, MapPage's --map-inset-left) it is centred on the map
 * the sheet leaves, as the map's buttons stand: centred on the screen, a
 * could-not line went under the sheet's foot and the Stops button (the
 * iOS audit, landscape, 2026-10-28).
 *
 * The radio's (RadioLayer) after what is ahead: a call to us with its
 * actions, and the captions while the app listens, once it first has.
 */
export default function MapBanners({ map }: { map: GlMap | null }) {
  // The microphone's pill too, which stays with what it heard or why it
  // heard nothing until put away: with nothing heard it went with the
  // listening, a few seconds after the tap (the owner's report, 2026-11-02).
  const radio = useAtcRadio(s => s.listening || !!s.error || s.heard.length > 0 || s.pill !== null);
  // In flight the buttons either side are 60 points (MapControls), so the
  // column stands between them, as the canvas's Flying screen has the
  // alert clear of the stack.
  const flying = useFlying(s => s.flying);
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-[calc(max(env(safe-area-inset-bottom),var(--map-inset-bottom,0px))+1.5rem)] z-[1000] flex flex-col items-center gap-2 nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] nav-bottom:right-[max(1rem,env(safe-area-inset-right))] nav-bottom:left-[calc(max(1rem,env(safe-area-inset-left))+var(--map-inset-left,0px))] nav-bottom:bottom-auto",
        flying
          ? "right-[calc(max(0.5rem,env(safe-area-inset-right))+4.75rem)] left-[calc(max(0.5rem,env(safe-area-inset-left))+var(--map-inset-left,0px)+4.75rem)]"
          : "right-[calc(max(0.5rem,env(safe-area-inset-right))+3.25rem)] left-[calc(max(0.5rem,env(safe-area-inset-left))+var(--map-inset-left,0px)+3.25rem)]",
      )}
    >
      {/* The zoom level while it changes (ZoomBanner), first. */}
      <ZoomBanner map={map} />
      {/* The sunlight scheme, the first time the light sensor turns it on. */}
      <SunlightBanner />
      <AlertsBanner />
      {radio && <Suspense fallback={null}><RadioLayer /></Suspense>}
      <AircraftAlerts />
      <ProblemBanner />
    </div>
  );
}
