import { createContext } from "react";

/**
 * How a card from the map puts itself away before it acts -- a station's
 * Direct To, a waypoint's Add to Route (PointActions): the Leaflet map's
 * popup closed (MapPopup), or the WebGL map's sheet card (GlMapShell).
 * Nothing where no map gave one.
 */
export const CardCloseContext = createContext<() => void>(() => {});
