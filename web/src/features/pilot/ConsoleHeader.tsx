import { useContext } from "react";
import { cn } from "cn";
import CloseButton from "../../components/CloseButton";
import { ConsoleInPanelContext } from "../../components/mapChrome";
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { TEXT } from "../../lib/text";

/**
 * The console's title row where it is a sheet of its own over the page (an
 * iPad, a desktop): its name and its close. As a layer of the map's panel
 * on a phone, nothing: the tab bar's tabs put it away, and who is signed
 * in and the mode are the Account tab's (AccountRow), at the owner's ask -- the
 * row took room over every tab.
 */
export default function ConsoleHeader({ console }: { console: string }) {
  const inPanel = useContext(ConsoleInPanelContext);
  if (inPanel) return null;
  return (
    <SheetHeader className="flex-row items-center gap-2 border-b py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
      <SheetTitle className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.title)}>{console}</SheetTitle>
      <SheetDescription className="sr-only">The {console.toLowerCase()} console</SheetDescription>
      <SheetClose asChild>
        <CloseButton data-testid="console-close" />
      </SheetClose>
    </SheetHeader>
  );
}
