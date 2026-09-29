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
 * The line both consoles open with: "Hello", and the name of whoever
 * is signed in as a stock dropdown with Log out in it; to nobody yet,
 * "Hello" and a Sign in button at the right-hand end. The sheet's
 * close button is drawn here rather than by the sheet
 * (`showCloseButton={false}`), so the greeting, the button and the
 * close share one row and one baseline. The name and a Log out button
 * used to be a "Signed in as …" line under the tabs, and the title the
 * console's name, which the button that opened it had already said.
 */
export default function ConsoleHeader({ console }: { console: string }) {
  const { data: pilot, isLoading, isError, refetch } = useQuery(pilotQuery);
  const logout = useLogout();
  return (
    <SheetHeader className="flex-row items-center gap-2 border-b py-3">
      {/* A button inside the heading: the dialog's name is still
          "Hello <name>", and the name is what opens the menu. */}
      <SheetTitle className="flex min-w-0 flex-1 items-center gap-1">
        {/* The space is in the text, not only in the gap: the dialog's
            name, and a test reading it, get "Hello <name>". */}
        <span>Hello{pilot && " "}</span>
        {pilot && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-1 min-w-0 px-1 font-heading text-base font-medium" data-testid="pilot-menu">
                <span className="truncate">{pilot.displayName}</span>
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
