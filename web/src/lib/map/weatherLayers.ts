import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The winds aloft's altitude on the map: the plan's cruise, or one of
 *  the FD product's own (AC 00-45H: 3,000 to 39,000 ft), or none. */
export type WindsAt = "off" | "plan" | 3000 | 6000 | 9000 | 12000 | 18000;

/**
 * Which weather the map draws, at the owner's pick (the canvas's map
 * weather, A: the map's own button, 2026-10-20), each the pilot's to turn
 * on or off and kept on this device: the radar and the areas on unless
 * turned off, as what is ahead of the route; the rest off until asked for.
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
    set => ({ radar: true, satellite: false, areas: true, pireps: false, winds: "off", set: patch => set(patch) }),
    { name: "vfr.weatherLayers", partialize: ({ set: _set, ...kept }) => kept },
  ),
);
