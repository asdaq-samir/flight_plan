import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plane, Route, ShieldCheck, Sparkles, UserRound } from "lucide-react";
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
import SubscriptionPanel from "./SubscriptionPanel";
import { standing, subscriptionQuery, useSold } from "../../lib/subscription";
import PilotGuide from "./PilotGuide";
import SignInModal from "./SignInModal";
import AccountRow from "./AccountRow";

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
  const sold = useSold();
  const pages = {
    aircraft: { title: "Aircraft", content: <AircraftPanel /> },
    flights: { title: "Flights", content: <FlightsPanel /> },
    logbook: { title: "Logbook", content: <LogbookPanel aircraft={shortName(aircraft.label)} /> },
    minimums: { title: "Minimums", content: <MinimumsPanel /> },
    subscription: { title: "Subscription", content: <SubscriptionPanel /> },
  };
  return (
    <div className="pt-1.5">
      {/* Keyed on being signed out so a page open when the pilot signs out,
          or the session ends, goes back to the list: its panel would fetch
          signed out and show 401s with no word of why. "loading" is left
          out of the key, so the session check finishing does not throw
          away Minimums, which needs no sign-in, or an edit in it. */}
      <ConsolePages key={pilot === null || pilot === "error" ? "out" : "in"} back="Account" pages={pages}>
        <div className="space-y-4">
          {/* Who is signed in and the mode, first, as iOS's Settings puts
              the account at its top (AccountRow). */}
          <AccountRow />
          {account}
          {/* What the pilot has of the paid features, a row of its own over
              their things, as iOS's Settings puts the account's at the top. */}
          {/* Not where this deployment sells none (the proof of concept). */}
          {signedIn && sold && <SubscriptionRow />}
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

/** The Subscription page's row, with what the pilot has in a few words. */
function SubscriptionRow() {
  const { data: subscription } = useQuery(subscriptionQuery);
  return (
    <ListGroup>
      <PageRow
        page="subscription" title="Subscription" value={subscription ? standing(subscription) : undefined}
        media={<RowBadge colour={SETTING_BADGE.subscription}><Sparkles /></RowBadge>}
      />
    </ListGroup>
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
        { value: "library", label: "Account", content: <Personal pilot={pilotState} /> },
      ]}
    />
  );
}

/** Personal on its own, for the developer's console as a tab of its own,
 *  at the owner's ask ("make a personal tab in dev mode"): the account and
 *  the mode with it, and the pilot's own things. */
export function PersonalTab() {
  const { data: pilot, isLoading, isError } = useQuery(pilotQuery);
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));
  return <Personal pilot={pilotState} />;
}
