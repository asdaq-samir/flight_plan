import { useEffect } from "react";
import { create } from "zustand";
import { usePreferences, type ChartLight } from "./preferences";

/**
 * The chart in bright sunlight (the owner's canvas, "Sunlight mode",
 * 2026-11-03): on a phone held up in a sunlit cockpit the glass sheets
 * and a sectional's pale inks wash out, so the whole page goes to a
 * high-contrast scheme -- the chart's tiles at more contrast, the
 * course and the rings thicker, every sheet and the figure strip solid
 * white with black figures (index.css, `html[data-chart-light="bright"]`).
 *
 * Switched on by itself from the phone's ambient light sensor where the
 * browser has one (the Generic Sensor API's AmbientLightSensor: behind a
 * flag in Chrome, absent in Safari, so rare), and by hand from the map's
 * settings (MapSettings' Sunlight: Auto, On, Off). The first time it
 * comes on by itself a banner says so with a one-tap Keep off
 * (SunlightBanner).
 *
 * The airspace rings (AirspaceLinesCanvas) draw on a canvas at their
 * style's own weight (chartColors' LINE_CASING and the class's own
 * weights, module constants read at draw time), which no stylesheet
 * reaches: they stay at their width in sunlight until that layer reads
 * the attribute itself. The course (CourseLine) is Leaflet SVG, whose
 * stroke-width the stylesheet sets.
 */

/** Direct sunlight on the screen: full daylight is 10,000 lux and more
 *  (overcast 1,000, a bright room 500), so the scheme comes on past
 *  10,000 and goes off again under 4,000, the gap so a passing cloud or
 *  a hand over the sensor does not flick it. */
const ON_LUX = 10_000;
const OFF_LUX = 4_000;

interface Sensor {
  illuminance: number | null;
  start: () => void;
  stop: () => void;
  addEventListener: (name: "reading" | "error", fn: () => void) => void;
}
type SensorClass = new (options?: { frequency?: number }) => Sensor;

/** What the sensor says: bright, or not (and not where there is none). */
export const useSunlightSensor = create<{ bright: boolean }>(() => ({ bright: false }));

/** Whether the sunlight scheme is on, from the setting and the sensor. */
export function sunlightOn(chartLight: ChartLight, bright: boolean): boolean {
  return chartLight === "on" || (chartLight === "auto" && bright);
}

let sensor: Sensor | null = null;

/** The light sensor started, where the browser has one and allows it:
 *  the permission asked by name first, so a browser that would prompt
 *  for it on construction is not made to as the page opens. */
async function startSensor() {
  if (sensor) return;
  const Ambient = (window as unknown as { AmbientLightSensor?: SensorClass }).AmbientLightSensor;
  if (!Ambient) return;
  try {
    const status = await navigator.permissions?.query({ name: "ambient-light-sensor" as PermissionName });
    if (status && status.state === "denied") return;
    const s = new Ambient({ frequency: 1 });
    s.addEventListener("reading", () => {
      const lux = s.illuminance;
      if (lux == null) return;
      const was = useSunlightSensor.getState().bright;
      const now = was ? lux >= OFF_LUX : lux >= ON_LUX;
      if (now !== was) useSunlightSensor.setState({ bright: now });
    });
    s.addEventListener("error", () => { s.stop(); sensor = null; });
    s.start();
    sensor = s;
  } catch {
    // No sensor, or not allowed: the setting alone decides.
  }
}

function stopSensor() {
  sensor?.stop();
  sensor = null;
  useSunlightSensor.setState({ bright: false });
}

/** The scheme kept on <html> as `data-chart-light` ("bright" or
 *  "normal") from the setting and the sensor, which runs only while the
 *  setting is Auto. Mounted once, with the map's banners. */
export function useSunlight() {
  const chartLight = usePreferences(s => s.chartLight);
  const bright = useSunlightSensor(s => s.bright);
  useEffect(() => {
    if (chartLight === "auto") void startSensor();
    else stopSensor();
  }, [chartLight]);
  useEffect(() => {
    document.documentElement.dataset.chartLight = sunlightOn(chartLight, bright) ? "bright" : "normal";
  }, [chartLight, bright]);
  return sunlightOn(chartLight, bright);
}
