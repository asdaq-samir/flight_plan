import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plane, Route, ShieldCheck, UserRound } from "lucide-react";
import { cn } from "cn";
import ConsoleTabs from "../../components/ConsoleTabs";
import { ConsolePages, PageRow } from "../../components/ConsolePages";
import EmptyState from "../../components/EmptyState";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { RowBadge } from "../../components/RowBadge";
import { SETTING_BADGE } from "../../lib/rowBadges";
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
  { value: "aircraft", label: "Aircraft", icon: <Plane />, colour: SETTING_BADGE.aircraft },
  { value: "flights", label: "Flights", icon: <Route />, colour: SETTING_BADGE.flights },
  { value: "logbook", label: "Logbook", icon: <BookOpen />, colour: SETTING_BADGE.logbook },
  { value: "minimums", label: "Minimums", icon: <ShieldCheck />, colour: SETTING_BADGE.minimums },
];

/**
 * The pilot's own things in one tab, Personal (it was Library, at the
 * pilot's ask): their airplanes, their filed flights, their logbook and
 * their personal minimums, a row each that opens its page, as iOS's
 * Settings lists its parts -- each with its glyph in a colour of its own
 * -- at the pilot's ask: they were a segmented control under the
 * console's tabs, tabs inside tabs. A page's own pages (a flight, an
 * entry) open over it with the way back to it (ConsolePages). The first
 * three need a sign-in: signed out, what signing in keeps is said once
 * over the list with the way in, and their rows wait greyed; the
 * minimums are kept on this device and need none.
 */
function Personal({ pilot }: { pilot: PilotState }) {
  // The airplane picked for planning, for a logbook entry's, and said on
  // its row.
  const aircraft = usePreferences(s => s.aircraft);
  const signedIn = pilot !== "loading" && pilot !== "error" && pilot !== null;
  // Signed out, said once over the list, as iOS's Settings asks to sign
  // in at its top: what signing in keeps, and the way in.
  const account = pilot === "loading" ? <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Checking your sign-in…</p>
    : pilot === "error" ? <EmptyState icon={<UserRound />} title="Sign-in Unknown">Your sign-in status could not be checked.</EmptyState>
      : !signedIn ? (
        <EmptyState icon={<UserRound />} title="Not Signed In" action={<SignInModal />}>
          Sign in to keep your aircraft for the nav log, the flights you plan, and a logbook with your currency.
        </EmptyState>
      ) : null;
  const pages = {
    aircraft: { title: "Aircraft", content: <AircraftPanel /> },
    flights: { title: "Flights", content: <FlightsPanel /> },
    logbook: { title: "Logbook", content: <LogbookPanel aircraft={shortName(aircraft.label)} /> },
    minimums: { title: "Minimums", content: <MinimumsPanel /> },
  };
  return (
    <div className="pt-1.5">
      <ConsolePages back="Personal" pages={pages}>
        <div className="space-y-4">
          {account}
          <div data-testid="library-section">
            <ListGroup>
              {SECTIONS.map(s => {
                const badge = <RowBadge colour={s.colour}>{s.icon}</RowBadge>;
                // The account's three greyed until there is one; the
                // minimums are this device's.
                return s.value === "minimums" || signedIn ? (
                  <PageRow
                    key={s.value} page={s.value} title={s.label} media={badge}
                    value={s.value === "aircraft" && aircraft.label ? shortName(aircraft.label) : undefined}
                  />
                ) : (
                  <ListRow key={s.value} title={s.label} media={badge} chevron disabled onClick={() => undefined} />
                );
              })}
            </ListGroup>
          </div>
        </div>
      </ConsolePages>
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
