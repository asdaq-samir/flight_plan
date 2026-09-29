import { useQuery } from "@tanstack/react-query";
import { ChevronDown, XIcon } from "lucide-react";
import IconButton from "../../components/IconButton";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { pilotQuery } from "../../lib/queryClient";
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
    <SheetHeader className="flex-row items-center gap-2 border-b py-3">
      {/* A button inside the heading: the dialog's name is the pilot's,
          and the name is what opens the menu. 16/600: the sheet's own
          title, one step above its sections' 14/600; the name in it the
          same, not the button's default. */}
      <SheetTitle className="flex min-w-0 flex-1 items-center text-base font-semibold">
        {pilot ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2 min-w-0 px-2 font-heading text-base font-semibold" data-testid="pilot-menu">
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
      {isLoading && <span className="text-sm text-muted-foreground">Checking sign-in…</span>}
      {isError && <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry sign-in check</Button>}
      {!isLoading && !isError && !pilot && <SignInModal />}
      <SheetClose asChild>
        <IconButton label="Close" size="icon-sm"><XIcon /></IconButton>
      </SheetClose>
    </SheetHeader>
  );
}
