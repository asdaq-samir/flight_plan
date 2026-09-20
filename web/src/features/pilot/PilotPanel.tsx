import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import IconButton from "../../components/IconButton";
import ThemeToggle from "../../components/ThemeToggle";
import { api } from "../../lib/api/client";
import { AircraftPanel, FlightsPanel, SignInStatus, type PilotState } from "./AccountPanels";

/** The header button that opens the console -- `aria-expanded` so the
 *  state is readable, the same as the sidebar's own toggle. */
export function PilotButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <IconButton label="Pilot" aria-expanded={open} onClick={onClick} data-testid="pilot-button">
      <UserRound className="size-5" />
    </IconButton>
  );
}

/**
 * The pilot's own console, in a `MapDrawer` dropping down over the map
 * (see PlanView): who is signed in, their aeroplanes, their filed
 * flights, and the theme -- the things that used to live on a Settings
 * page two taps from the map. Not the nav log or the briefing: those
 * have their own places already (the right drawer, the Brief tab). The
 * developer's page has the same drawer in the same place, holding the
 * developer's things instead (see DevPanel).
 */
export function PilotPanel() {
  const {
    data: pilot, isLoading, isError, refetch,
  } = useQuery({ queryKey: ["pilot"], queryFn: api.me, retry: false });
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SignInStatus pilot={pilotState} onRetry={() => void refetch()} />
          <ThemeToggle />
        </div>
        <div className="mt-5 space-y-6">
          <AircraftPanel pilot={pilotState} />
          <FlightsPanel pilot={pilotState} />
        </div>
      </div>
    </div>
  );
}
