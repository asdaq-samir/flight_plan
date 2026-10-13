import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { useConfirm } from "../../components/useConfirm";
import { useDevMode } from "../../hooks/use-dev-mode";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import { useDeleteAccount } from "./useDeleteAccount";
import { useLogout } from "./useLogout";

/**
 * Who is signed in and the mode they are in, the Account tab's first row, at the
 * owner's ask ("I don't like the pilot and sign in taking space under
 * settings. We should move the role to personal"): it was the console's
 * title row over every tab. The name, and at its end the mode -- Pilot,
 * or Developer where the account may be one -- a menu that also signs out
 * and deletes the account (App Review 5.1.1(v): an app that makes
 * accounts deletes them from inside it). None where there is nobody
 * signed in and no developer's mode to offer: Personal's own sign-in says
 * what signing in keeps.
 */
export default function AccountRow() {
  const { data: pilot } = useQuery(pilotQuery);
  const devMode = useDevMode();
  const logout = useLogout();
  const deleteAccount = useDeleteAccount();
  const [askDelete, deleteDialog] = useConfirm({
    title: "Delete your account?",
    description: "Your airplanes, flights, logbook, saved tracks and the checkpoint notes you wrote go, on every "
      + "device, and you are signed out. This can't be undone.",
    confirmLabel: "Delete account",
    destructive: true,
    onConfirm: () => deleteAccount.mutate(),
  });
  if (!pilot && !devMode.allowed) return null;
  return (
    // No heading of its own: the tab it leads is Account, at the owner's
    // ask ("Rename personal to account").
    <ListGroup>
      <ListRow title={<span className="truncate" data-testid="pilot-address">{pilot?.displayName ?? "Not signed in"}</span>}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" data-testid="role-menu" className={cn("relative -mr-2 px-2 font-normal text-tint after:absolute after:-inset-y-2 after:inset-x-0", TEXT.row)}>
              {devMode.on ? "Developer" : "Pilot"}
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
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
      </ListRow>
      {deleteDialog}
    </ListGroup>
  );
}
