import { useEffect } from "react";
import { usePreferences, type Brand } from "./preferences";

/** The Chart ink look's value, said here until preferences' Brand union
 *  has it ("sectional" | "cockpit" | "windsock" | "clearsky" | "ink"). */
const INK: Brand = "ink";

/** The looks, as Settings lists them: the owner's four from the brand
 *  canvas (2026-10-26: "I would also like to have those color schemes A
 *  to D in the settings for pilots to switch"), and Chart ink, the app in
 *  the FAA sectional's own ink, at the owner's pick of the ink canvas
 *  (2026-11-04: "let's try it"). Their colours are tokens on
 *  <html data-brand> (index.css); their typefaces load here. */
export const BRANDS: { value: Brand; label: string }[] = [
  { value: "sectional", label: "Sectional" },
  { value: "cockpit", label: "Glass Cockpit" },
  { value: "windsock", label: "Windsock" },
  { value: "clearsky", label: "Clear Sky" },
  { value: INK, label: "Chart ink" },
];

/** Each look's typeface, fetched only when it is picked: Sectional's
 *  Inter is the page's own (index.css), in its first load. Chart ink
 *  reads in Barlow, as the cockpit does, with Barlow Condensed for a
 *  figure's label, an ident and a word button (index.css --display,
 *  lib/text's label and word). */
const FONTS: Partial<Record<Brand | "ink", () => Promise<unknown>>> = {
  cockpit: () => import("@fontsource/barlow/latin-500.css").then(() => Promise.all([
    import("@fontsource/barlow/latin-600.css"), import("@fontsource/barlow/latin-700.css"), import("@fontsource/barlow/latin-400.css"),
  ])),
  windsock: () => import("@fontsource-variable/archivo"),
  clearsky: () => import("@fontsource-variable/manrope"),
  ink: () => import("@fontsource/barlow/latin-400.css").then(() => Promise.all([
    import("@fontsource/barlow/latin-500.css"), import("@fontsource/barlow/latin-600.css"), import("@fontsource/barlow/latin-700.css"),
    import("@fontsource/barlow-condensed/latin-600.css"), import("@fontsource/barlow-condensed/latin-700.css"),
  ])),
};

/** Whether the Chart ink look is on, for what sets its own type or its
 *  own ink by it as it renders: the figures' sizes and labels
 *  (FigureStrip), the checkpoints' marks (RouteMap, PointMark). A
 *  canvas, which no render reaches, reads it off <html> instead
 *  (chartColors' isInkLook). */
export function useInkLook(): boolean {
  return usePreferences(s => s.brand) === INK;
}

/** Puts the pilot's look on <html> (data-brand), and its typeface in. */
export function BrandLook() {
  const brand = usePreferences(s => s.brand);
  useEffect(() => {
    document.documentElement.dataset.brand = brand;
    void FONTS[brand]?.().catch(() => { /* the system's face meanwhile */ });
  }, [brand]);
  return null;
}
