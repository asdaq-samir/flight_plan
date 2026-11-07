import { useEffect, useState } from "react";
import { levelOf } from "../useView";
import { aheadOf, type Box } from "../view";
import { useGlMap } from "./glLayer";
import { leafletZoomOf } from "./glStyle";

export interface GlView {
  /** The view and a screen round it on the half-degree grid (aheadOf):
   *  what the overlays ask the planner for, the same boxes, keys and cache
   *  as the Leaflet map's useAhead. */
  box: Box;
  /** The whole level the map is at, in Leaflet's zoom: what every layer's
   *  FROM_ZOOM is written in. */
  level: number;
}

/** The view as it last came to rest. A box already asked for keeps being
 *  the answer while the view stays inside it and it is not much bigger
 *  than the view would ask for now (view.ts within). */
export function useGlView(): GlView {
  const { map } = useGlMap();
  const read = (was?: GlView): GlView => {
    const b = map.getBounds();
    const level = levelOf(leafletZoomOf(map.getZoom()));
    const ahead = aheadOf(b);
    const inside = was && b.getSouth() >= was.box.box.south && b.getWest() >= was.box.box.west
      && b.getNorth() <= was.box.box.north && b.getEast() <= was.box.box.east
      && was.box.box.north - was.box.box.south <= 3 * (ahead.box.north - ahead.box.south);
    return { box: inside ? was.box : ahead, level };
  };
  const [view, setView] = useState<GlView>(() => read());
  useEffect(() => {
    const rest = () => setView(was => {
      const now = read(was);
      return now.box === was.box && now.level === was.level ? was : now;
    });
    map.on("moveend", rest);
    return () => { map.off("moveend", rest); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read is the map's
  }, [map]);
  return view;
}
