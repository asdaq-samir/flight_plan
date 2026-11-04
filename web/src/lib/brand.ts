import { useEffect } from "react";
import { usePreferences, type Brand } from "./preferences";

const INK: Brand = "ink";

/** The looks, as Settings lists them: the Glass Cockpit, from the
 *  owner's brand canvas (2026-10-26), and Chart ink, the app in the FAA
 *  sectional's own ink (2026-11-04: "let's try it") -- the two the owner
 *  kept ("Only keep the glass cockpit and chart ink", 2026-11-04). Their
 *  colours are tokens on <html data-brand> (index.css); their typefaces
 *  load here. */
export const BRANDS: { value: Brand; label: string }[] = [
  { value: "cockpit", label: "Glass Cockpit" },
  { value: INK, label: "Chart ink" },
];

/** Each look's own typeface beyond Barlow, which both read in and which
 *  is in the first stylesheet (main.tsx), fetched only when it is
 *  picked: Chart ink's Barlow Condensed for a figure's label, an ident
 *  and a word button (index.css --display, lib/text's label and word). */
const FONTS: Record<Brand, () => Promise<unknown>> = {
  cockpit: () => Promise.resolve(),
  ink: () => Promise.all([
    import("@fontsource/barlow-condensed/latin-600.css"), import("@fontsource/barlow-condensed/latin-700.css"),
  ]),
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
    void FONTS[brand]?.()?.catch(() => { /* the system's face meanwhile */ });
  }, [brand]);
  return null;
}
