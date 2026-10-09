import { Children, cloneElement, useContext, type MouseEvent, type ReactElement } from "react";
import { ConsoleInPanelContext } from "./mapChrome";
import { SheetClose } from "./ui/sheet";

/**
 * Its one child puts the console away as it is tapped -- a row that goes
 * to the map ("Open on the map") -- whichever the console is: the sheet's
 * own close (SheetClose) where it is a sheet, and the panel's layer's
 * close on a phone (ConsoleInPanelContext), where there is no sheet to
 * close and a SheetClose stopped the page.
 */
export default function ConsoleClose({ children }: { children: ReactElement<{ onClick?: (event: MouseEvent) => void }> }) {
  const inPanel = useContext(ConsoleInPanelContext);
  if (!inPanel) return <SheetClose asChild>{children}</SheetClose>;
  const child = Children.only(children);
  return cloneElement(child, {
    onClick: (event: MouseEvent) => {
      child.props.onClick?.(event);
      inPanel.close();
    },
  });
}
