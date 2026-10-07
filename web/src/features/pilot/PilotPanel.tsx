import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { cn } from "cn";
import ConsoleTabs from "../../components/ConsoleTabs";
import EmptyState from "../../components/EmptyState";
import Segmented from "../../components/Segmented";
import type { Pilot } from "../../lib/api/types";
import { pilotQuery } from "../../lib/queryClient";
import { shortName } from "../../lib/aircraftChoice";
import { TEXT } from "../../lib/text";
import { AircraftPanel, FlightsPanel } from "./AccountPanels";
import { LogbookPanel } from "./LogbookPanel";
import MinimumsPanel from "./MinimumsPanel";
import PilotGuide from "./PilotGuide";
import SignInModal from "./SignInModal";

/** Who is signed in, or why nobody is: null signed out, "loading"
 *  while the check is in flight, "error" when it failed. */
type PilotState = Pilot | null | "loading" | "error";

const SECTIONS = [
  { value: "aircraft", label: "Aircraft" },
  { value: "flights", label: "Flights" },
  { value: "logbook", label: "Logbook" },
  { value: "minimums", label: "Minimums" },
];

/**
 * The pilot's own things in one tab, Personal (it was Library, at the
 * pilot's ask): their airplanes, their filed flights, their logbook and
 * their personal minimums, picked with a segmented control as iOS picks
 * between views of one place. The first three need a sign-in, and signed
 * out say once what signing in keeps, with the way in; the minimums are
 * kept on this device and need none. The control steps aside while one
 * of them has a page open (ConsolePages), as a pushed page covers it.
 */
function Personal({ pilot }: { pilot: PilotState }) {
  const saved = usePreferences(s => s.librarySection);
  const choose = usePreferences(s => s.setLibrarySection);
  // The airplane picked for planning, for a logbook entry's.
  const aircraft = usePreferences(s => s.aircraft);
  const section = SECTIONS.some(s => s.value === saved) ? saved : "aircraft";

  const signedIn = pilot !== "loading" && pilot !== "error" && pilot !== null;
  return (
    <div className="group/library space-y-4 pt-1.5">
      <Segmented
        label="Personal" value={section} onChange={choose} options={SECTIONS} testId="library-section"
        className="w-full group-has-[[data-slot=console-page]]/library:hidden [&>*]:flex-1"
      />
      {section === "minimums" ? <MinimumsPanel />
        : pilot === "loading" ? <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Checking your sign-in…</p>
          : pilot === "error" ? <EmptyState icon={<UserRound />} title="Sign-in Unknown">Your sign-in status could not be checked.</EmptyState>
            : !signedIn ? (
              <EmptyState icon={<UserRound />} title="Not Signed In" action={<SignInModal />}>
                Sign in to keep your aircraft for the nav log, the flights you plan, and a logbook with your currency.
              </EmptyState>
            ) : section === "flights" ? <FlightsPanel />
              : section === "logbook" ? <LogbookPanel aircraft={shortName(aircraft.label)} />
                : <AircraftPanel />}
    </div>
  );
}

/**
 * The pilot's console, opened from the map's Settings button on the
 * planner (MapPage): the guide to the planner (first: where a newcomer
 * starts), Personal: their own airplanes, flights, logbook and minimums,
 * then the settings. The shape is `ConsoleTabs`, shared with the
 * developer's console. Not the nav log or the briefing: those are the
 * panel over the map.
 */
export function PilotPanel() {
  const { data: pilot, isLoading, isError } = useQuery(pilotQuery);
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));
  const savedTab = usePreferences(s => s.pilotTab);
  const changeTab = usePreferences(s => s.setPilotTab);
  // Aircraft, Flights and Logbook were tabs of their own: a console left
  // on one opens on Personal.
  const tab = SECTIONS.some(s => s.value === savedTab) ? "library" : savedTab;

  return (
    <ConsoleTabs
      saved={tab}
      onChange={changeTab}
      tabs={[
        { value: "guide", label: "Guide", content: <PilotGuide /> },
        { value: "library", label: "Personal", content: <Personal pilot={pilotState} /> },
      ]}
    />
  );
}
