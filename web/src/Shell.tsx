import type { ReactNode } from "react";
import PageHeader from "./components/PageHeader";

interface Props {
  toolbar: ReactNode;
  map: ReactNode;
  /** Floats over the map itself (progress, errors) rather than pushing
   *  it down -- the map area is `relative` so this can be `absolute`. */
  mapOverlay?: ReactNode;
  sidebar: ReactNode;
  /** Which page this is, for PageHeader's own nav -- "plan" or
   *  "label," the only two Shell-based pages. */
  active: "plan" | "label";
}

/**
 * The one structural layout both pages mount into: PageHeader takes a
 * fixed slot at the top, and the map fills the rest of the viewport
 * edge to edge below it, with the toolbar and sidebar floating on top
 * of the map area as overlays (each positions itself; see
 * CollapsibleToolbar/Sidebar) rather than taking their own row/column
 * out of that inner layout. `h-dvh`, not `h-screen` (100vh): mobile
 * Safari's `vh` is sized off the viewport with its own chrome
 * collapsed, so a bottom-anchored element positioned against a
 * `h-screen` container can end up hidden behind the address/tab bar
 * when it's actually showing -- `dvh` tracks the chrome's real,
 * current size instead.
 *
 * `print:h-auto print:overflow-visible`, on both this outer flex
 * column and the inner map wrapper, matters for exactly one case: the
 * Flight Briefing page, which is taller than one screen and needs the
 * browser's own pagination to lay it across multiple printed pages.
 * Without both overrides the fixed `h-dvh`/`overflow-hidden` here
 * clips everything below the first viewport-height's worth of
 * content, no matter what print overrides the briefing page's own
 * markup declares -- an ancestor's `overflow: hidden` still clips a
 * descendant's content when printing, `print:overflow-visible` set
 * further down or not. PageHeader itself is `print:hidden` and so
 * contributes nothing to that printed page at all.
 */
export default function Shell({ toolbar, map, mapOverlay, sidebar, active }: Props) {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-white print:h-auto print:overflow-visible">
      <PageHeader active={active} />
      <div className="relative flex-1 overflow-hidden print:h-auto print:overflow-visible">
        {map}
        {mapOverlay}
        {toolbar}
        {sidebar}
      </div>
    </div>
  );
}
