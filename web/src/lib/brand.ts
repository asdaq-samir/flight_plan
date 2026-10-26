import { useEffect } from "react";
import { usePreferences, type Brand } from "./preferences";

/** The four looks, as Settings lists them (the owner's canvas of brand
 *  options, 2026-10-26: "I would also like to have those color schemes A
 *  to D in the settings for pilots to switch"). Their colours are tokens
 *  on <html data-brand> (index.css); their typefaces load here. */
export const BRANDS: { value: Brand; label: string }[] = [
  { value: "sectional", label: "Sectional" },
  { value: "cockpit", label: "Glass Cockpit" },
  { value: "windsock", label: "Windsock" },
  { value: "clearsky", label: "Clear Sky" },
];

/** Each look's typeface, fetched only when it is picked: Sectional's
 *  Inter is the page's own (index.css), in its first load. */
const FONTS: Partial<Record<Brand, () => Promise<unknown>>> = {
  cockpit: () => import("@fontsource/barlow/latin-500.css").then(() => Promise.all([
    import("@fontsource/barlow/latin-600.css"), import("@fontsource/barlow/latin-700.css"), import("@fontsource/barlow/latin-400.css"),
  ])),
  windsock: () => import("@fontsource-variable/archivo"),
  clearsky: () => import("@fontsource-variable/manrope"),
};

/** Puts the pilot's look on <html> (data-brand), and its typeface in. */
export function BrandLook() {
  const brand = usePreferences(s => s.brand);
  useEffect(() => {
    document.documentElement.dataset.brand = brand;
    void FONTS[brand]?.().catch(() => { /* the system's face meanwhile */ });
  }, [brand]);
  return null;
}
