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
export default function MapHeader({ leading, form, actions }: Props) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-background px-2 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2 sm:px-3 print:hidden">
      <div className="flex items-center [&>*]:size-8 sm:justify-self-start sm:[&>*]:size-9">{leading}</div>
      {form}
      <div className="ml-auto flex items-center gap-1 [&>*]:size-8 sm:ml-0 sm:justify-self-end sm:gap-2 sm:[&>*]:size-9">
        {actions}
      </div>
    </header>
  );
}
