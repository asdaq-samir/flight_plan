import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plane, Route, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { cn } from "cn";
import { useContext, type ReactNode } from "react";
import { Activity, CircleHelp, Info, Settings } from "lucide-react";
import AboutPanel from "../../components/AboutPanel";
import { ConsoleSettingsContext } from "../../components/mapChrome";
import { ConsolePages, PageRow, PageTile } from "../../components/ConsolePages";
import EmptyState from "../../components/EmptyState";
import { PillSection } from "../../components/Favorites";
import { ListGroup } from "../../components/GroupedList";
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
import SetupPill from "./SetupPill";
import TabPage, { TAB_PAGE_GAP } from "../../components/TabPage";

/** Who is signed in, or why nobody is: null signed out, "loading"
 *  while the check is in flight, "error" when it failed. */
type PilotState = Pilot | null | "loading" | "error";

const SECTIONS = [
  { value: "aircraft", label: "Aircraft", icon: <Plane />, colour: SETTING_BADGE.aircraft },
  // Flights are FPL's too (its SAVED strip and card), at the owner's pick
  // of the redesign; here with the pilot's other things all the way up.
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
/** The developer's own pages in Setup: the stack's status, and the
 *  guide to training the model in place of the planner's guide. */
export interface DevPages {
  status: ReactNode;
  guide: ReactNode;
}

function Personal({ pilot, dev }: {
  pilot: PilotState;
  /** The developer's Setup (DevPanel): its Status and its own Guide. */
  dev?: DevPages;
}) {
  // The airplane picked for planning, for a logbook entry's, and said on
  // its row.
  const aircraft = usePreferences(s => s.aircraft);
  const signedIn = pilot !== "loading" && pilot !== "error" && pilot !== null;
  // While the sign-in is checked, or where it could not be, said under
  // the account (signed out, its way in is the account's own, SetupPill).
  const account = pilot === "loading" ? <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Checking your sign-in…</p>
    : pilot === "error" ? <EmptyState icon={<UserRound />} title="Sign-in Unknown">Your sign-in status could not be checked.</EmptyState>
      : null;
  const sold = useSold();
  // The pilot's things, a tile each as Favorites' places are, at the
  // owner's ask: the account's three greyed until there is one; the
  // minimums are this device's.
  const sectionRows = SECTIONS.map(s => (
    <PageTile
      key={s.value} page={s.value} title={s.label} icon={s.icon} colour={s.colour} disabled={!(s.value === "minimums" || signedIn)}
      detail={s.value === "aircraft" && aircraft.label ? shortName(aircraft.label) : undefined}
    />
  ));
  const settings = useContext(ConsoleSettingsContext);
  const pages = {
    ...(dev ? { status: { title: "Status", content: dev.status } } : {}),
    settings: { title: "Settings", content: settings },
    guide: { title: "Guide", content: dev ? dev.guide : <PilotGuide /> },
    about: { title: "About", content: <AboutPanel /> },
    aircraft: { title: "Aircraft", content: <AircraftPanel /> },
    flights: { title: "Flights", content: <FlightsPanel /> },
    logbook: { title: "Logbook", content: <LogbookPanel aircraft={shortName(aircraft.label)} /> },
    minimums: { title: "Minimums", content: <MinimumsPanel /> },
    subscription: { title: "Subscription", content: <SubscriptionPanel /> },
  };
  return (
    <>
      {/* Keyed on being signed out so a page open when the pilot signs out,
          or the session ends, goes back to the list: its panel would fetch
          signed out and show 401s with no word of why. "loading" is left
          out of the key, so the session check finishing does not throw
          away Minimums, which needs no sign-in, or an edit in it. */}
      <ConsolePages key={pilot === null || pilot === "error" ? "out" : "in"} back="Account" pages={pages}>
        <div className={cn("flex flex-col", TAB_PAGE_GAP)}>
          {/* Setup's page starts as its half card does -- Controls, the
              switches -- so a drag up only adds what is under them, at the
              owner's ask ("make the dragging up consistent in fpl and
              setup as well"); the account then heads the Account group
              ("move the email down with aircraft's etc and label the
              section Account"). */}
          <SetupPill testId="setup-head" rows={sectionRows} />
          {account}
          {/* What the pilot has of the paid features, a row of its own by
              their things, as iOS's Settings puts the account's at the top. */}
          {/* Not where this deployment sells none (the proof of concept). */}
          {signedIn && sold && <SubscriptionRow />}
          <>
              {/* The rest of the app as rows that open their pages, as
                  iPhone's Settings lists its own -- at the owner's pick of
                  the redesign, where Guide, Account, Settings and About
                  were tabs. */}
              <PillSection title="App">
              <ListGroup>
                {dev && <PageRow page="status" title="Status" media={<RowBadge colour={SETTING_BADGE.general}><Activity /></RowBadge>} />}
                <PageRow page="settings" title="Settings" media={<RowBadge colour={SETTING_BADGE.general}><Settings /></RowBadge>} />
                <PageRow page="guide" title="Guide" media={<RowBadge colour={SETTING_BADGE.guide}><CircleHelp /></RowBadge>} />
                <PageRow page="about" title="About" media={<RowBadge colour={SETTING_BADGE.about}><Info /></RowBadge>} />
              </ListGroup>
              </PillSection>
          </>
        </div>
      </ConsolePages>
    </>
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
export function PilotPanel({ dev }: {
  /** The developer's Setup, at the owner's pick of the dev page's
   *  redesign: the pilot's, its Status and Guide the developer's, where
   *  it was a console of tabs of its own (Guide, Status, Account). */
  dev?: DevPages;
} = {}) {
  const { data: pilot, isLoading, isError } = useQuery(pilotQuery);
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));
  // One page, no tabs over it, at the owner's pick of the redesign (S3d
  // all the way up): the account and its rows, the switches, then the
  // settings, the guide and about, each a row that opens its page. A tab's
  // page as the others' are (TabPage), with no head: its first section
  // where their search bars start.
  return (
    <TabPage testId="setup-page" headless>
      <Personal pilot={pilotState} dev={dev} />
    </TabPage>
  );
}
