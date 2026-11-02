import type { PathOptions } from "leaflet";
import { useEffect } from "react";
import { CircleMarker } from "react-leaflet";
import { create } from "zustand";

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

/** How many map cards (MapPopup) wear their ring now: while one does, the
 *  airport whose card is under it gives up its own (AirportsLayer), so one
 *  thing is ringed at a time -- the owner's screenshot (2026-11-02) had
 *  KLAS and the VPVSM waypoint opened over it ringed both. */
export const useCardRings = create<{ open: number }>(() => ({ open: 0 }));

/** A map card's ring, counted while it is drawn. */
export function CardHalo({ at }: { at: { lat: number; lon: number } }) {
  useEffect(() => {
    useCardRings.setState(s => ({ open: s.open + 1 }));
    return () => useCardRings.setState(s => ({ open: s.open - 1 }));
  }, []);
  return <Halo at={at} />;
}
