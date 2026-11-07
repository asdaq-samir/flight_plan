import { memo } from "react";
import { fromChunk } from "../../lib/fromChunk";

// The route's box -- the search the planner opens on -- on a chunk of its
// own, not in the route panel's (routePanel): there the search waited for
// the whole chunk, 640 KB, 214 KB gzipped, of nav log, briefing,
// procedures and cards, which shared a phone's connection with the map
// (issue #214); its own is 22 KB (9 KB). main.tsx asks for this one at once,
// beside the first script; the route panel's comes once the page has
// painted (routePanelParts).
// Drawn again only when its props change (memo), as the panel's parts are.
const { Part, prefetch } = fromChunk(() => import("./components/RouteBox"), m => m.default);
export const RouteBox = memo(Part);
export const prefetchRouteBox = prefetch;
