import type { LatLon } from "./geo";

/** Degrees and decimal minutes, as a chart's margins and a GPS write a
 *  position: "N42°19.0′ W088°05.4′". */
export function degreesMinutes({ lat, lon }: LatLon): string {
  const part = (value: number, positive: string, negative: string, width: number) => {
    // Tenths of a minute first, then degrees and minutes: 59.96 minutes
    // rounded on their own printed "N42°60.0′" for N43°00.0′.
    const tenths = Math.round(Math.abs(value) * 600);
    const whole = Math.floor(tenths / 600);
    const minutes = (tenths - whole * 600) / 10;
    return `${value >= 0 ? positive : negative}${String(whole).padStart(width, "0")}°${minutes.toFixed(1).padStart(4, "0")}′`;
  };
  return `${part(lat, "N", "S", 2)} ${part(lon, "E", "W", 3)}`;
}
