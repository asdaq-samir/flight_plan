import { useQuery } from "@tanstack/react-query";
import { ChevronDown, XIcon } from "lucide-react";
import { cn } from "cn";
import IconButton from "../../components/IconButton";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import SignInModal from "./SignInModal";
import { useLogout } from "./useLogout";

/**
 * The line both consoles open with: the name of whoever is signed in,
 * as a stock dropdown with Log out in it; to nobody yet, the console's
 * own name and a Sign in button at the right-hand end. The sheet's
 * close button is drawn here rather than by the sheet
 * (`showCloseButton={false}`), so the title, the button and the close
 * share one row and one baseline. The name and a Log out button used
 * to be a "Signed in as …" line under the tabs, and the title the
 * console's name whoever was signed in; "Hello" before the name was
 * tried and dropped.
 */
export default function ConsoleHeader({ console }: { console: string }) {
  const { data: pilot, isLoading, isError, refetch } = useQuery(pilotQuery);
  const logout = useLogout();
  return (
    // Its sides clear the island of a phone on its side: from the top, the
    // sheet spans the screen.
    <SheetHeader className="flex-row items-center gap-2 border-b py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
      {/* A button inside the heading: the dialog's name is the pilot's,
          and the name is what opens the menu. Semibold at a sheet's
          title's size (TEXT) -- 16 over its sections' 14, and 17 to a
          finger, as an iOS navigation bar's title is; the name in it
          the same, not the button's default. */}
      <SheetTitle className={cn("flex min-w-0 flex-1 items-center font-semibold", TEXT.title)}>
        {pilot ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Pulled left by its own padding, so the name lines up with
                  the row's edge -- but not into the island's inset on a
                  phone on its side, where the row's padding is the inset. */}
              <Button variant="ghost" size="sm" className={cn("ml-[min(0px,calc(env(safe-area-inset-left)-0.5rem))] min-w-0 px-2 font-heading font-semibold text-foreground", TEXT.title)} data-testid="pilot-menu">
                <span className="truncate">{pilot.displayName}</span>
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="capitalize">{console}</span>
        )}
      </SheetTitle>
      <SheetDescription className="sr-only">The {console} console</SheetDescription>
      {isLoading && <span className={cn("text-muted-foreground", TEXT.prose)}>Checking sign-in…</span>}
      {isError && <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry sign-in check</Button>}
      {!isLoading && !isError && !pilot && <SignInModal />}
      <SheetClose asChild>
        <IconButton label="Close"><XIcon className="size-5" /></IconButton>
      </SheetClose>
    </SheetHeader>
  );
}
