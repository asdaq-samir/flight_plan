import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import IconButton from "../../components/IconButton";
import Segmented from "../../components/Segmented";
import { Button } from "../../components/ui/button";
import { SheetClose, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { useDevMode } from "../../hooks/use-dev-mode";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import SignInModal from "./SignInModal";

/**
 * The line both consoles open with. For a developer (useDevMode), Pilot
 * and Developer in place of the title, a segmented control as iOS puts
 * one in a navigation bar: the console and the page under it change
 * together, and the console stays open across the change. It was the
 * Dev mode switch in the settings, under a title that said which
 * console this was, and the map had a button for each. For anyone
 * else, the console's name; and to nobody signed in yet, a Sign in
 * button at the right-hand end. Who is signed in, and Log out, are the
 * first group of the settings (AccountGroup). The sheet's close button
 * is drawn here rather than by the sheet (`showCloseButton={false}`),
 * so the title, the button and the close share one row.
 */
export default function ConsoleHeader({ console }: { console: string }) {
  const { data: pilot, isLoading, isError, refetch } = useQuery(pilotQuery);
  const devMode = useDevMode();
  return (
    // Its sides clear the island of a phone on its side: from the top, the
    // sheet spans the screen.
    <SheetHeader className="flex-row items-center gap-2 border-b py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
      {/* The title semibold at a sheet's title's size (TEXT): 17 to a
          finger, as an iOS navigation bar's title is. Named for a screen
          reader still where the switch stands in for it. */}
      <SheetTitle className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.title, devMode.allowed && "sr-only")}>{console}</SheetTitle>
      {devMode.allowed && (
        <div className="min-w-0 flex-1">
          <Segmented
            label="Pilot or developer" testId="mode-toggle"
            value={devMode.on ? "developer" : "pilot"}
            onChange={v => { if ((v === "developer") !== devMode.on) devMode.flip(); }}
            options={[{ value: "pilot", label: "Pilot" }, { value: "developer", label: "Developer" }]}
          />
        </div>
      )}
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
