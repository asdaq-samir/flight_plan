import { Children, cloneElement, useContext, type MouseEvent, type ReactElement } from "react";
import { ConsoleInPanelContext } from "./mapChrome";

/**
 * Its one child puts Setup away as it is tapped -- a row that goes to the
 * map ("Open on the map") -- through the panel's layer's close
 * (ConsoleInPanelContext), Setup being that layer on every screen. Where
 * the same page is shown outside Setup -- a flight's page from FPL's
 * Saved -- there is nothing to put away, and the child is itself: a
 * SheetClose there, a dialog's close with no dialog round it, threw as
 * the page was drawn and took the whole planner down.
 */
export default function ConsoleClose({ children }: { children: ReactElement<{ onClick?: (event: MouseEvent) => void }> }) {
  const inPanel = useContext(ConsoleInPanelContext);
  if (!inPanel) return children;
  const child = Children.only(children);
  return cloneElement(child, {
    onClick: (event: MouseEvent) => {
      child.props.onClick?.(event);
      inPanel.close();
    },
  });
}
