import type { PathOptions } from "leaflet";
import { CircleMarker } from "react-leaflet";

// Constants, not literals: react-leaflet restyles a path whenever its
// pathOptions is a new object.
const OUTER: PathOptions = { color: "rgba(10,20,28,.55)", weight: 9, fill: false, interactive: false };
const INNER: PathOptions = { color: "#ffffff", weight: 6, fill: false, interactive: false };
const RING: PathOptions = { color: "#ff3b00", weight: 3, fill: false, interactive: false };

/**
 * The ring around the selected point: cased both sides so it holds over
 * black roads and blank paper alike. Drawn after the markers, so it is
 * on top of them.
 */
export function Halo({ at }: { at: { lat: number; lon: number } }) {
  const center: [number, number] = [at.lat, at.lon];
  return (
    <>
      <CircleMarker center={center} radius={19} pathOptions={OUTER} />
      <CircleMarker center={center} radius={19} pathOptions={INNER} />
      <CircleMarker center={center} radius={19} pathOptions={RING} />
    </>
  );
}
