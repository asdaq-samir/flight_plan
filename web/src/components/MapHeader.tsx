import type { ReactNode } from "react";

interface Props {
  /** Leads the row, on the route form's left: the Dev-mode switch,
   *  on both pages. */
  leading: ReactNode;
  /** The route form: this page's real title, the thing a pilot or a
   *  developer opened it to use, so it sits in the middle. */
  form: ReactNode;
  /** The header's icon buttons, in one group at the trailing edge:
   *  the guide, the zoom toggle, the console and the sidebar toggle --
   *  the same four, in the same order, on both pages. */
  actions: ReactNode;
  /** Dev mode: only `data-mode` says so here -- the DEV switch at the
   *  leading edge is the one visible sign, on purpose (an amber header
   *  was tried, and was too much). */
  dev?: boolean;
}

/**
 * The one-row header both pages share: the Dev-mode switch leading,
 * the route form centred, the icon buttons trailing. From `sm` up, a
 * three-column grid whose flanking columns match each other's width
 * (the switch in one, the actions in the other), which is what centres
 * the form against the header's full width rather than against
 * whatever is left beside the actions. Below `sm` a plain flex row
 * puts the switch and the form first and the actions at the right,
 * and everything is slimmed to share one line on a phone: the
 * header's own padding and gaps close up, and every icon button drops
 * to `icon-sm` (`size-8`, the same size the form's own Load button
 * already is) -- set here, on the groups, rather than on each button
 * in each page's header. A row still wraps rather than clipping on a
 * screen narrower than that. Never a scroll container -- one that
 * overflows by a pixel grows a scrollbar the moment a mouse is
 * attached.
 *
 * Hidden in print: on paper the page is the briefing (see `MapDrawer`'s
 * `printable`), which carries its own title.
 */
export default function MapHeader({ leading, form, actions, dev = false }: Props) {
  return (
    <header
      data-mode={dev ? "dev" : "pilot"}
      // The safe-area insets (real only because index.html asks for
      // `viewport-fit=cover`): installed to the Home Screen this row is
      // the top of the screen, so its padding grows to clear a notch or
      // a Dynamic Island, and its sides clear the rounded corners in
      // landscape. In a browser tab every inset is zero and these are
      // the plain paddings they replace.
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-background pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-2 pl-[max(0.5rem,env(safe-area-inset-left))] sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2 sm:pr-[max(0.75rem,env(safe-area-inset-right))] sm:pl-[max(0.75rem,env(safe-area-inset-left))] print:hidden"
    >
      <div className="flex items-center sm:justify-self-start">{leading}</div>
      {/* mx-auto below `sm`: the flex row's free space split either side
          of the form, so it sits centred between the switch and the
          buttons rather than packed against the switch (the grid from
          `sm` up centres it against the whole header by itself). */}
      <div className="mx-auto sm:mx-0 sm:justify-self-center">{form}</div>
      {/* gap-2/gap-3, not gap-1/gap-2: the form is centred against the
          whole header, so there is always room to the left of this
          group and the buttons inside it were the only crowded thing
          in the row. */}
      <div className="ml-auto flex items-center gap-2 [&>*]:size-8 sm:ml-0 sm:justify-self-end sm:gap-3 sm:[&>*]:size-9">
        {actions}
      </div>
    </header>
  );
}
