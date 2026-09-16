/**
 * The floating dark button every page's map-view action uses --
 * `MapActionButton`'s own text pill and `NavLogActions`' icon-only
 * pair both read as the same button family because they share this
 * exact string, not two independently hand-matched ones that could
 * quietly drift apart the way a shadow value or a hover shade would
 * if each component kept its own copy.
 */
export const DARK_BUTTON =
  "border-2 border-white bg-slate-900 text-white shadow-[0_2px_10px_rgba(0,0,0,.5)] hover:bg-slate-800 active:bg-black";
