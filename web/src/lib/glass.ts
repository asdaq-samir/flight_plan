/** The glass's light and shade, one for both themes, their colours the
 *  theme's (index.css's --glass-*): a light across the top, a half-point
 *  edge round it and a soft shade under it, as iOS's glass is (the
 *  owner's "shouldn't it be common code between light and dark?"). For
 *  every button's glass (components/mapChrome's GLASS_BUTTON) and the
 *  route's airport pills (lib/useAirspace's AIRSPACE_PILL). */
export const GLASS_EDGE = "shadow-[inset_0_1px_0_var(--glass-light),0_0_0_0.5px_var(--glass-edge),0_2px_8px_var(--glass-shade)]";
