import { CircleMarker } from "react-leaflet";

/**
 * The ring around the selected point: cased both sides so it holds over
 * black roads and blank paper alike. Drawn after the markers, so it is
 * on top of them.
 */
export function Halo({ at }: { at: { lat: number; lon: number } }) {
  const center: [number, number] = [at.lat, at.lon];
  return (
    <>
      <CircleMarker center={center} radius={19} pathOptions={{ color: "rgba(10,20,28,.55)", weight: 9, fill: false, interactive: false }} />
      <CircleMarker center={center} radius={19} pathOptions={{ color: "#ffffff", weight: 6, fill: false, interactive: false }} />
      <CircleMarker center={center} radius={19} pathOptions={{ color: "#ff3b00", weight: 3, fill: false, interactive: false }} />
    </>
  );
}
