import type { LatLon } from "./geo";

/** Degrees and decimal minutes, as a chart's margins and a GPS write a
 *  position: "N42°19.0′ W088°05.4′". */
export function degreesMinutes({ lat, lon }: LatLon): string {
  const part = (value: number, positive: string, negative: string, width: number) => {
    const whole = Math.floor(Math.abs(value));
    const minutes = (Math.abs(value) - whole) * 60;
    return `${value >= 0 ? positive : negative}${String(whole).padStart(width, "0")}°${minutes.toFixed(1).padStart(4, "0")}′`;
  };
  return `${part(lat, "N", "S", 2)} ${part(lon, "E", "W", 3)}`;
}
