import L from "leaflet";
import { memo, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Marker, Pane, useMap } from "react-leaflet";
import { Button } from "../../components/ui/button";
import { api } from "../api/client";
import { hovers } from "./view";
import { useAhead, useLiveZoom } from "./useView";
import { diamondIcon } from "./icons";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { MAGENTA } from "../useAirspace";
import { MapTooltip } from "./MapTooltip";
import { PointWhere } from "./PointWhere";

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
  // As the airports' marks are asked for and drawn (useAhead, useLiveZoom):
  // the view and a screen round it, asked again under a finger's pan or
  // pinch, and the zoom each whole level a pinch passes. The diamonds were
  // asked for only once the map had stopped, so none came in under the
  // finger, a pan's or a pinch's.
  const zoom = useLiveZoom();
  const asked = useAhead();
  const { data } = useQuery({
    queryKey: ["waypointsInView", asked.key],
    queryFn: () => api.waypointsInView(asked.box),
    enabled: zoom >= FROM_ZOOM,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  // The diamonds made again only when the answer changes, not at each
  // level a zoom passes: a pan inside the same half-degree box drew every
  // diamond, and its open card, again (MapPopup).
  const diamonds = useMemo(() => (data ?? []).filter(w => !exclude.has(w.ident)), [data, exclude]);
  if (zoom < FROM_ZOOM) return null;
  return (
    <Pane name="waypoints" style={{ zIndex: 440 }}>
      {diamonds.map(w => <WaypointMark key={w.ident} waypoint={w} onAddStop={onAddStop} />)}
    </Pane>
  );
}

/** A tap on a diamond kept off the map under it. A constant: react-leaflet
 *  binds a marker's handlers again whenever they are a new object. */
const STOP_CLICK = { click: (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e) };

/** One VFR waypoint's diamond and its card, drawn again only when the
 *  waypoint changes: made inline, every diamond had a new position and new
 *  handlers at every draw of the map -- each placed on the page again, its
 *  handlers unbound and bound -- at every zoom's end. */
const WaypointMark = memo(function WaypointMark({ waypoint: w, onAddStop }: {
  waypoint: { ident: string; lat: number; lon: number; description?: string | null };
  onAddStop?: (waypoint: { ident: string; lat: number; lon: number }) => void;
}) {
  const map = useMap();
  const position = useMemo<[number, number]>(() => [w.lat, w.lon], [w.lat, w.lon]);
  return (
    <Marker position={position} icon={diamondIcon()} eventHandlers={STOP_CLICK}>
      {/* In Leaflet's own panes, not this one: a popup in the
          diamonds' pane had the diamonds after it drawn over it. */}
      {hovers && <MapTooltip pane="tooltipPane">{w.ident} · VFR waypoint{w.description ? ` ${w.description}` : ""}</MapTooltip>}
      <MapPopup pane="popupPane" panOnce>
        {/* No name of its own: what it is beside its ident, and where it
            is on a line of its own (the planner's vfr.places), at the
            pilot's ask -- on one line the card ran the screen's width. */}
        <MapCard
          pill={{ name: `${w.ident} VFR waypoint`, line: w.description || undefined, colour: MAGENTA }}
          // The chart's diamond, as the map marks it, before its ident.
          media={<span aria-hidden="true" className="mx-1.5 size-3.5 shrink-0 rotate-45 rounded-[2px] border-2 border-white shadow-sm" style={{ backgroundColor: MAGENTA }} />}
          title={<>{w.ident}<span className="font-normal text-muted-foreground">VFR waypoint</span></>}
          subtitle={w.description || undefined}
        >
          <PointWhere lat={w.lat} lon={w.lon} />
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
  );
});
