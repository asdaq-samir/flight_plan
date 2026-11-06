import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The winds aloft's altitude on the map: the plan's cruise, or one of
 *  the FD product's own (AC 00-45H: 3,000 to 39,000 ft), or none. */
export type WindsAt = "off" | "plan" | 3000 | 6000 | 9000 | 12000 | 18000;

/**
 * Which weather the map draws, at the owner's pick (the canvas's map
 * weather, A: the map's own button, 2026-10-20), each the pilot's to turn
 * on or off and kept on this device. All off until asked for: a SIGMET or
 * a G-AIRMET is hundreds of miles across, and drawn by default it took
 * the tap meant for the airport, the airspace or the chart under it (CI's
 * run 42198681351: places, classb, airspace-lines and route-fit), as the
 * radar's tiles darkened every map before the pilot had asked for weather.
 */
interface WeatherLayers {
  radar: boolean;
  satellite: boolean;
  areas: boolean;
  pireps: boolean;
  winds: WindsAt;
  set: (patch: Partial<Omit<WeatherLayers, "set">>) => void;
}

export const useWeatherLayers = create<WeatherLayers>()(
  persist(
    set => ({ radar: false, satellite: false, areas: false, pireps: false, winds: "off", set: patch => set(patch) }),
    { name: "wingtip.weatherLayers", partialize: ({ set: _set, ...kept }) => kept },
  ),
);
