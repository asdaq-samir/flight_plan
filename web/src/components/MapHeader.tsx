import type { ReactNode } from "react";

interface Props {
  /** Leads the row, on the route form's left: the sidebar's button,
   *  on both pages, the sidebar opening on that side. */
  leading: ReactNode;
  /** The route form: this page's real title, the thing a pilot or a
   *  developer opened it to use, so it sits in the middle. */
  form: ReactNode;
  /** The header's icon buttons, in one group at the trailing edge:
   *  the console and the settings -- the same two, in the same order,
   *  on both pages. */
  actions: ReactNode;
  /** Dev mode: only `data-mode` says so here -- the console's button
   *  and the switch in the settings are the visible signs, on purpose
   *  (an amber header was tried, and was too much). */
  dev?: boolean;
}

/**
 * The one-row header both pages share: the sidebar's button leading,
 * the route form centred, the console and the settings trailing. A
 * three-column grid whose flanking columns share the space left over
 * equally (the sidebar's button in one, the others in the other; the
 * Dev-mode switch led it once), which is what centres the
 * form against the header's full width rather than against whatever is
 * left beside the actions -- on a phone too. It used to be a flex row
 * below `sm`, which centred the form between the switch and the
 * buttons: on the planner of anyone signed out or not a developer
 * there is no switch, and the form sat 55px left of centre, where the
 * dev page's did not. Only a screen under 360px, too narrow for the
 * three side by side, is still a wrapping flex row. Below `sm`
 * everything is slimmed to share one line on a phone: the
 * header's own padding and gaps close up, and every icon button drops
 * to `icon-sm` (`size-8`, the same size the form's own Load button
 * already is) -- set here, on the groups, rather than on each button
 * in each page's header. A row still wraps rather than clipping on a
 * screen narrower than that. Never a scroll container -- one that
 * overflows by a pixel grows a scrollbar the moment a mouse is
 * attached.
 *
 * The screen's bottom row or its top one, as picked in the map's
 * settings (useNavEdge): by default the bottom on a phone, where a
 * thumb reaches it, as iOS puts a toolbar and Safari its address bar,
 * and the top from `md` up. Only its place moves (`order-last` in the
 * page's column): it is still first in the page's order, so a keyboard
 * and a screen reader meet it before the map, as they did.
 *
 * Hidden in print: on paper the page is the briefing (see `MapDrawer`'s
 * `printable`), which carries its own title.
 */
export default function MapHeader({ leading, form, actions, dev = false }: Props) {
  return (
    <header
      data-mode={dev ? "dev" : "pilot"}
      // The grid from 22.5rem of the inset's width (360px at the default
      // type size; a container query, see MapPage), the wrapping row
      // below that.
      // The safe-area insets on the top and the right only (and real
      // only because index.html asks for `viewport-fit=cover`): this
      // row is the top of the screen, so its padding grows to clear a
      // notch or a Dynamic Island, and its right edge is the screen's.
      // Its left edge is not: the drawer sits there whenever it is
      // open, and padding by that side's inset spent 59px of a
      // landscape iPhone's width on nothing and pushed this row's own
      // content into overlapping itself -- the route form ran over the
      // console button, when the drawer was on the right. A plain
      // padding there instead, a little wider than the other side's,
      // which is enough to clear a rounded corner with the drawer shut.
      // At the bottom instead (the `nav-bottom` variant): the border on
      // its top edge, and the padding under it grown to clear the home
      // indicator rather than the notch (the page's column clears that).
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-background pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-2 pl-3 @min-[22.5rem]:grid @min-[22.5rem]:grid-cols-[1fr_auto_1fr] nav-bottom:order-last nav-bottom:border-t nav-bottom:border-b-0 nav-bottom:pt-2 nav-bottom:pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-2 sm:pr-[max(0.75rem,env(safe-area-inset-right))] sm:pl-4 print:hidden"
    >
      <div className="flex items-center [&>*]:size-8 @min-[22.5rem]:justify-self-start sm:[&>*]:size-9">{leading}</div>
      {/* mx-auto for the wrapping row under 360px; the grid above that
          centres it against the whole header by itself. */}
      <div className="mx-auto @min-[22.5rem]:mx-0 @min-[22.5rem]:justify-self-center">{form}</div>
      {/* gap-2 either side of `sm`, not gap-3 above it: the ring on an
          open button (see `EXPANDED_BUTTON`) is what separates these
          two now, and the extra 4px only cost width in the one place
          the row is tight -- a landscape phone with the drawer open. */}
      <div className="ml-auto flex items-center gap-2 [&>*]:size-8 @min-[22.5rem]:ml-0 @min-[22.5rem]:justify-self-end sm:[&>*]:size-9">
        {actions}
      </div>
    </header>
  );
}
