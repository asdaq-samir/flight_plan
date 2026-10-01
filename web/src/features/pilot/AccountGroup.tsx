import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { pilotQuery } from "../../lib/queryClient";
import { useLogout } from "./useLogout";

/**
 * Who is signed in, first in the settings, as iOS puts the account at
 * the top of Settings: the address by a person's mark, and Log out
 * under it in red, as Sign Out is. It was the console's title, a menu
 * with Log out in it, where a long address crowded the close button
 * and the title said nothing about the console. Nobody signed in, it
 * is not here: the console's header has Sign in.
 */
export default function AccountGroup() {
  const { data: pilot } = useQuery(pilotQuery);
  const logout = useLogout();
  if (!pilot) return null;
  return (
    <ListGroup title="Account" footer="Your aircraft and flights are kept under this address.">
      <ListRow
        media={(
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserRound className="size-5" />
          </span>
        )}
        title={<span className="font-medium break-words" data-testid="account-address">{pilot.displayName}</span>}
        description="Signed in"
      />
      <ListRow
        title={<span className="text-destructive-ink">Log out</span>}
        onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="log-out"
      />
    </ListGroup>
  );
}
