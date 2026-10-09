import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { useDevMode } from "../../hooks/use-dev-mode";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import SignInModal from "./SignInModal";
import { useLogout } from "./useLogout";
import CloseButton from "../../components/CloseButton";
import { ConsoleInPanelContext } from "../../components/mapChrome";
import { useConfirm } from "../../components/useConfirm";
import { useDeleteAccount } from "./useDeleteAccount";

/**
 * The line both consoles open with, one row: the role as the title, a
 * menu -- Pilot, Developer for whoever may use dev mode (useDevMode),
 * and Sign out and Delete account last for whoever is signed in -- then who is signed in,
 * small and grey in whatever room is left, then the close button.
 * Picking the other role changes the page under the console, which
 * stays out across the change (useConsoleOpen). It was a Pilot and
 * Developer segmented control with the address a menu of its own under
 * it, a second row; before that the Dev mode switch in the settings,
 * and an Account group there.
 *
 * Nobody signed in, and no dev mode: the console's name, and a Sign in
 * button at the end. The sheet's close button is drawn here rather than
 * by the sheet (`showCloseButton={false}`), so it sits on this row.
 */
export default function ConsoleHeader({ console }: { console: string }) {
  // A layer of the map's panel on a phone (MapPage): its own heading and
  // close, there being no sheet's.
  const inPanel = useContext(ConsoleInPanelContext);
  const { data: pilot, isLoading, isError, refetch } = useQuery(pilotQuery);
  const devMode = useDevMode();
  const logout = useLogout();
  const deleteAccount = useDeleteAccount();
  // Asked first, red, saying what goes: App Review 5.1.1(v) has an app
  // that makes accounts delete them, from inside the app.
  const [askDelete, deleteDialog] = useConfirm({
    title: "Delete your account?",
    description: "Your airplanes, flights, logbook, saved tracks and the checkpoint notes you wrote go, on every "
      + "device, and you are signed out. This can't be undone.",
    confirmLabel: "Delete account",
    destructive: true,
    onConfirm: () => deleteAccount.mutate(),
  });
  const menu = !!pilot || devMode.allowed;
  return (
    // Its sides clear the island of a phone on its side: from the top, the
    // sheet spans the screen.
    <SheetHeader className="flex-row items-center gap-2 border-b py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
      {/* The title semibold at a sheet's title's size (TEXT): 17 to a
          finger, as an iOS navigation bar's title is. Named for a screen
          reader still where the menu stands in for it. */}
      {inPanel
        ? <h2 className={cn("min-w-0 truncate font-semibold", TEXT.title, menu && "sr-only")}>{console}</h2>
        : <SheetTitle className={cn("min-w-0 truncate font-semibold", TEXT.title, menu && "sr-only")}>{console}</SheetTitle>}
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Pulled left by its own padding, so the role lines up with
                the row's edge -- but not into the island's inset on a
                phone on its side, where the row's padding is the inset. */}
            <Button
              variant="ghost" size="sm" data-testid="role-menu"
              className={cn("ml-[min(0px,calc(env(safe-area-inset-left)-0.5rem))] shrink-0 px-2 font-heading font-semibold text-foreground", TEXT.title)}
            >
              {console}
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuRadioGroup
              value={devMode.on ? "developer" : "pilot"}
              onValueChange={v => { if ((v === "developer") !== devMode.on) devMode.flip(); }}
            >
              <DropdownMenuRadioItem value="pilot">Pilot</DropdownMenuRadioItem>
              {devMode.allowed && <DropdownMenuRadioItem value="developer">Developer</DropdownMenuRadioItem>}
            </DropdownMenuRadioGroup>
            {pilot && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => logout.mutate()} disabled={logout.isPending}>Sign out</DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive" data-testid="delete-account" disabled={deleteAccount.isPending}
                  // After the menu has closed: a dialog opened while it still
                  // holds the focus has its own taken back.
                  onSelect={() => setTimeout(askDelete)}
                >
                  Delete account…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Who is signed in, in the room between the menu and the close,
          cut short with an ellipsis rather than pushing either off. */}
      <span className={cn("min-w-0 flex-1 truncate text-muted-foreground", TEXT.note)} data-testid="pilot-address">
        {pilot?.displayName}
      </span>
      {!inPanel && <SheetDescription className="sr-only">The {console.toLowerCase()} console</SheetDescription>}
      {isLoading && <span className={cn("text-muted-foreground", TEXT.prose)}>Checking sign-in…</span>}
      {isError && <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry sign-in check</Button>}
      {!isLoading && !isError && !pilot && <SignInModal />}
      {inPanel ? (
        <CloseButton onClick={inPanel.close} data-testid="console-close" />
      ) : (
        <SheetClose asChild>
          <CloseButton data-testid="console-close" />
        </SheetClose>
      )}
      {deleteDialog}
    </SheetHeader>
  );
}
