import { useQuery } from "@tanstack/react-query";
import { BookOpen, GraduationCap, LogIn, LogOut, Plane, Settings, UserRound } from "lucide-react";
import { cn } from "cn";
import { GLASS } from "../../components/mapChrome";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import { useLogout } from "../pilot/useLogout";
import { initialsOf } from "./stripData";

/** What the menu opens, each an existing screen in the sheet. */
export type ProfileScreen = "airplane" | "logbook" | "instructor" | "settings";

/**
 * The round profile button beside the one field, at the right of the
 * pill's row (OneField), where Maps has the person (the owner's
 * screenshot, 2026-11-04; it was at the map's top right): the pilot's
 * initials, or a person's glyph signed out, and a small menu -- My
 * airplane, Logbook, Instructor, Settings, Sign in or Sign out -- each
 * opening the existing screen in the sheet. Glass, as the map's own
 * buttons are, 44 points: its own size is the hit area. Its test id is
 * kept from its corner days for the suite.
 */
export default function ProfileButton({ onOpen }: { onOpen: (screen: ProfileScreen) => void }) {
  const { data: pilot } = useQuery(pilotQuery);
  const logout = useLogout();
  const initials = initialsOf(pilot);
  return (
    <div className="shrink-0 print:hidden" data-testid="profile-corner">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button" aria-label={pilot ? `${pilot.displayName}: the pilot's menu` : "The pilot's menu"} data-testid="profile-button"
            className={cn(
              GLASS, "flex size-11 items-center justify-center rounded-full font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              TEXT.row,
            )}
          >
            {initials || <UserRound className="size-5" strokeWidth={2.25} aria-hidden="true" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48" data-testid="profile-menu">
          {pilot && (
            <>
              <DropdownMenuLabel className={cn("max-w-64 truncate font-normal text-muted-foreground", TEXT.note)}>{pilot.displayName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => onOpen("airplane")} data-testid="profile-airplane"><Plane aria-hidden="true" />My airplane</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("logbook")} data-testid="profile-logbook"><BookOpen aria-hidden="true" />Logbook</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("instructor")} data-testid="profile-instructor"><GraduationCap aria-hidden="true" />Instructor</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("settings")} data-testid="profile-settings"><Settings aria-hidden="true" />Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          {pilot ? (
            <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending} data-testid="profile-sign-out"><LogOut aria-hidden="true" />Sign out</DropdownMenuItem>
          ) : (
            // The sign-in is Setup's own card (SignInModal, its Account group).
            <DropdownMenuItem onSelect={() => onOpen("settings")} data-testid="profile-sign-in"><LogIn aria-hidden="true" />Sign in</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
