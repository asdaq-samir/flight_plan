import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import IconButton from "../../components/IconButton";
import { Button } from "../../components/ui/button";
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import SignInModal from "./SignInModal";

/**
 * The line both consoles open with: the console's name -- the pilot's
 * or the developer's -- and, to nobody signed in yet, a Sign in button
 * at the right-hand end. Who is signed in, and Log out, are the first
 * group of the settings (AccountGroup), as iOS puts the account at the
 * top of Settings: as the title, a menu, a long address crowded the
 * close button and the title said nothing about the console. The
 * sheet's close button is drawn here rather than by the sheet
 * (`showCloseButton={false}`), so the title, the button and the close
 * share one row and one baseline.
 */
export default function ConsoleHeader({ console }: { console: string }) {
  const { data: pilot, isLoading, isError, refetch } = useQuery(pilotQuery);
  return (
    // Its sides clear the island of a phone on its side: from the top, the
    // sheet spans the screen.
    <SheetHeader className="flex-row items-center gap-2 border-b py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
      {/* Semibold at a sheet's title's size (TEXT): 17 to a finger, as an
          iOS navigation bar's title is. */}
      <SheetTitle className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.title)}>{console}</SheetTitle>
      <SheetDescription className="sr-only">The {console.toLowerCase()} console</SheetDescription>
      {isLoading && <span className={cn("text-muted-foreground", TEXT.prose)}>Checking sign-in…</span>}
      {isError && <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry sign-in check</Button>}
      {!isLoading && !isError && !pilot && <SignInModal />}
      <SheetClose asChild>
        <IconButton label="Close"><XIcon className="size-5" /></IconButton>
      </SheetClose>
    </SheetHeader>
  );
}
