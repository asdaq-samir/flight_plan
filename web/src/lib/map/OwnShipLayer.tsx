import { useEffect, useMemo } from "react";
import { Circle, Marker, useMap, useMapEvents } from "react-leaflet";
import { ownShipIcon } from "./icons";
import { useOwnShip } from "./ownShip";

/**
 * Own ship on the chart, from the position store: the arrow turned to
 * the GPS heading, the GPS's own accuracy as a faint circle under it,
 * and while `follow` the map kept centred on it -- until a pan by the
 * pilot's own finger, which ends following until the layers popover's
 * checkbox again. Nothing about it is interactive: a pilot's finger
 * over their own position is panning the map, not asking for a popup.
 */
export function OwnShipLayer() {
  const map = useMap();
  const enabled = useOwnShip(s => s.enabled);
  const fix = useOwnShip(s => s.fix);
  const follow = useOwnShip(s => s.follow);
  const setFollow = useOwnShip(s => s.setFollow);
  // Memoized handlers: see `useZoomLevel` -- a literal re-registers on
  // every commit and can miss an event fired during one.
  useMapEvents(useMemo(
    () => ({ dragstart: () => { if (useOwnShip.getState().follow) setFollow(false); } }),
    [setFollow],
  ));
  useEffect(() => {
    if (enabled && fix && follow) map.panTo([fix.lat, fix.lon], { animate: true, duration: 0.5 });
  }, [map, enabled, fix, follow]);
  if (!enabled || !fix) return null;
  return (
    <>
      <Circle
        center={[fix.lat, fix.lon]} radius={fix.accuracyM}
        pathOptions={{ color: "#1d4ed8", weight: 1, opacity: 0.5, fillColor: "#3b82f6", fillOpacity: 0.08, interactive: false }}
      />
      <Marker position={[fix.lat, fix.lon]} icon={ownShipIcon(fix.headingDeg)} interactive={false} zIndexOffset={1000} keyboard={false} />
    </>
  );
}
