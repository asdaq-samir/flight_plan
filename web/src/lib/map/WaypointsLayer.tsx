import L from "leaflet";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Marker, Pane, useMap, useMapEvents } from "react-leaflet";
import { Button } from "../../components/ui/button";
import { api } from "../api/client";
import { boxOf, hovers } from "./view";
import { diamondIcon } from "./icons";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { MapTooltip } from "./MapTooltip";

/** From this zoom in, as the airports' (AirportsLayer): further out the
 *  diamonds would be a scatter over every city's airspace. */
const FROM_ZOOM = 8;

/**
 * The chart's VFR waypoints (VPBNG), each marked with a magenta diamond
 * from zoom 8 in: the sectional prints them as small flags, too small to
 * read zoomed out and not a thing to tap. A tap names it and, with a
 * route open (`onAddStop`), puts it in the stops to be flown through.
 * Under the airports' chips, and not for one the route has already
 * (`exclude`), which wears its own.
 */
export function WaypointsLayer({ exclude, onAddStop }: {
  exclude: Set<string>;
  onAddStop?: (waypoint: { ident: string; lat: number; lon: number }) => void;
}) {
  const map = useMap();
  const [view, setView] = useState(() => boxOf(map));
  // Memoized: see AirportsLayer.
  const handlers = useMemo(() => ({ moveend: () => setView(boxOf(map)) }), [map]);
  useMapEvents(handlers);
  const { data } = useQuery({
    queryKey: ["waypointsInView", view.key],
    queryFn: () => api.waypointsInView(view.box),
    enabled: view.zoom >= FROM_ZOOM,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  if (view.zoom < FROM_ZOOM) return null;
  return (
    <Pane name="waypoints" style={{ zIndex: 440 }}>
      {(data ?? []).filter(w => !exclude.has(w.ident)).map(w => (
        <Marker
          key={w.ident} position={[w.lat, w.lon]} icon={diamondIcon()}
          eventHandlers={{ click: e => L.DomEvent.stopPropagation(e) }}
        >
          {/* In Leaflet's own panes, not this one: a popup in the
              diamonds' pane had the diamonds after it drawn over it. */}
          {hovers && <MapTooltip pane="tooltipPane">{w.ident} · VFR waypoint{w.description ? ` ${w.description}` : ""}</MapTooltip>}
          <MapPopup pane="popupPane">
            {/* No name of its own: where it is (the planner's vfr.places). */}
            <MapCard title={w.ident} subtitle={w.description ? `VFR waypoint ${w.description}` : "VFR waypoint"}>
              {onAddStop && (
                <Button
                  type="button" size="sm" className="w-full"
                  onClick={() => { map.closePopup(); onAddStop(w); }} data-testid="waypoint-add-stop"
                >
                  Add as a Stop
                </Button>
              )}
            </MapCard>
          </MapPopup>
        </Marker>
      ))}
    </Pane>
  );
}
