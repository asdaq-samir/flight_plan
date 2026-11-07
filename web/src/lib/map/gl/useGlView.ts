import { useEffect, useState } from "react";
import { aheadOf, within, type Box } from "../view";
import { useGlMap } from "./glLayer";
import { leafletZoomOf } from "./glStyle";

/** The whole level a zoom is at: every layer draws by whole levels
 *  (zoom >= FROM_ZOOM), the same under a pinch as at rest. */
export const levelOf = (zoom: number) => Math.floor(zoom + 1e-9);

export interface GlView {
  /** The view and a screen round it on the half-degree grid (aheadOf):
   *  what the overlays ask the planner for, each box asked once and
   *  cached. */
  box: Box;
  /** The whole level the map is at, in the app's levels (Leaflet's, which
   *  every layer's FROM_ZOOM is written in: MapLibre's zoom plus one). */
  level: number;
}

/** The view as it last came to rest. A box already asked for keeps being
 *  the answer while the view stays inside it and it is not much bigger
 *  than the view would ask for now (view.ts within). */
export function useGlView(): GlView {
  const { map } = useGlMap();
  const [view, setView] = useState<GlView>(() => ({ box: aheadOf(map.getBounds()), level: levelOf(leafletZoomOf(map.getZoom())) }));
  useEffect(() => {
    const rest = () => setView(was => {
      const bounds = map.getBounds();
      const box = within(bounds, was.box) ? was.box : aheadOf(bounds);
      const level = levelOf(leafletZoomOf(map.getZoom()));
      return box === was.box && level === was.level ? was : { box, level };
    });
    map.on("moveend", rest);
    return () => { map.off("moveend", rest); };
  }, [map]);
  return view;
}
