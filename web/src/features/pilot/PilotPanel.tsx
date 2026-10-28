import { Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plane, Route, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { cn } from "cn";
import type { ReactNode } from "react";
import AboutPanel from "../../components/AboutPanel";
import { ConsolePages, PageButton, PageLink, PageRow } from "../../components/ConsolePages";
import { PillSection } from "../../components/Favorites";
import EmptyState from "../../components/EmptyState";
import { ListGroup } from "../../components/GroupedList";
import { RowBadge } from "../../components/RowBadge";
import { SETTING_BADGE } from "../../lib/rowBadges";
import type { Pilot } from "../../lib/api/types";
import { api } from "../../lib/api/client";
import { flightsQuery, pilotQuery } from "../../lib/queryClient";
import { shortName } from "../../lib/aircraftChoice";
import { usePreferences } from "../../lib/preferences";
import type { Minimums } from "../../lib/minimums";
import { TEXT } from "../../lib/text";
import { AircraftPanel, FlightsPanel } from "./AccountPanels";
import { AccountMenu } from "./AccountMenu";
import { LogbookPanel } from "./LogbookPanel";
import MinimumsPanel from "./MinimumsPanel";
import SubscriptionPanel from "./SubscriptionPanel";
import { standing, subscriptionQuery, useSold } from "../../lib/subscription";
import PilotGuide from "./PilotGuide";
import PilotPage from "./PilotPage";
import SetupPill from "./SetupPill";
import TabPage, { TAB_PAGE_GAP } from "../../components/TabPage";

// Loaded when it is drawn, as PaidPrompt does: imported here it put the
// sign-in sheet in the first load for every pilot already signed in.
const SignInModal = lazy(() => import("./SignInModal"));

/** Who is signed in, or why nobody is: null signed out, "loading"
 *  while the check is in flight, "error" when it failed. */
type PilotState = Pilot | null | "loading" | "error";

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
  const minimums = usePreferences(s => s.minimums);
  const signedIn = pilot !== "loading" && pilot !== "error" && pilot !== null;
  // While the sign-in is checked, or where it could not be, said under
  // the controls (signed out, its way in is the account's own card).
  const account = pilot === "loading" ? <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Checking your sign-in…</p>
    : pilot === "error" ? <EmptyState icon={<UserRound />} title="Sign-in Unknown">Your sign-in status could not be checked.</EmptyState>
      : null;
  const sold = useSold();
  // Each of the pilot's things with where it stands at its row's end, at
  // the owner's pick (T3): asked for only signed in, as the rows open to
  // nothing otherwise.
  const { data: flights } = useQuery({ ...flightsQuery, enabled: signedIn });
  const { data: entries } = useQuery({ queryKey: ["logbook"], queryFn: api.logbook.list, enabled: signedIn, meta: { silent: true } });
  const hours = entries?.reduce((sum, e) => sum + (e.totalHours ?? 0), 0);
  const settings = minimumsWords(minimums);
  const pages = {
    ...(dev ? { status: { title: "Status", content: dev.status } } : {}),
    guide: { title: "Guide", content: dev ? dev.guide : <PilotGuide /> },
    about: { title: "About", content: <AboutPanel /> },
    aircraft: { title: "Airplanes", content: <AircraftPanel /> },
    flights: { title: "Flights", content: <FlightsPanel /> },
    logbook: { title: "Logbook", content: <LogbookPanel aircraft={shortName(aircraft.label)} /> },
    minimums: { title: "Minimums", content: <MinimumsPanel /> },
    subscription: { title: "Subscription", content: <SubscriptionPanel /> },
    pilot: { title: "Pilot details", content: <PilotPage /> },
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
          {/* The Controls first, as Setup's half card is, at the owner's
              pick of the canvas (2026-10-27, T3): a drag up only adds what
              is under them -- who is signed in, their things, and the way
              to the guide and about. The settings that were a page of
              their own went to the Controls and the map's menu. */}
          <SetupPill testId="setup-head" />
          {account}
          {/* A section as the page's others are, so the room between them
              is the one room every tab's sections keep (tab-consistency). */}
          <AccountCard pilot={signedIn ? pilot : null} />
          {/* The pilot's things, a row each with where it stands, as iOS's
              Settings lists its parts: the account's three greyed until
              there is one; the minimums are this device's. */}
          <div data-testid="library-section">
          <ListGroup>
              <PageRow
                page="aircraft" title="Airplanes" disabled={!signedIn} value={aircraft.label ? shortName(aircraft.label) : undefined}
                media={<RowBadge colour={SETTING_BADGE.aircraft}><Plane /></RowBadge>}
              />
              <PageRow
                page="flights" title="Flights" disabled={!signedIn} value={flights ? `${flights.length} saved` : undefined}
                media={<RowBadge colour={SETTING_BADGE.flights}><Route /></RowBadge>}
              />
              <PageRow
                page="logbook" title="Logbook" disabled={!signedIn} value={hours !== undefined && entries?.length ? `${hours.toFixed(1)} h` : undefined}
                media={<RowBadge colour={SETTING_BADGE.logbook}><BookOpen /></RowBadge>}
              />
              <PageRow
                page="minimums" title="Minimums" value={settings ?? undefined}
                media={<RowBadge colour={SETTING_BADGE.minimums}><ShieldCheck /></RowBadge>}
              />
          </ListGroup>
          </div>
          {signedIn && sold && <ListGroup><SubscriptionRow /></ListGroup>}
          {/* The guide (its tips with it) and about, links at the foot, at
              the owner's pick: a developer's status first. */}
          <nav aria-label="More" className="flex justify-center gap-6 pb-2">
            {dev && <PageLink page="status" testId="status-link">Status</PageLink>}
            <PageLink page="guide" testId="guide-link">Guide</PageLink>
            <PageLink page="about" testId="about-link">About</PageLink>
          </nav>
        </div>
      </ConsolePages>
    </>
  );
}

/** The personal minimums in a few words, the ceiling and visibility
 *  first; none set, nothing. */
function minimumsWords(m: Minimums): string | null {
  const parts = [
    m.visibilitySm !== null ? `${m.visibilitySm} mi` : null,
    m.ceilingFt !== null ? `${m.ceilingFt.toLocaleString("en-US")} ft` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Who is signed in, under an Account heading as the Controls have theirs
 *  (the owner, 2026-10-28): their initials, their name and address, the
 *  role's menu at its end (sign out, delete). A tap on it opens their
 *  details, for their flight plans. Signed out, the heading alone with
 *  Sign in at its right, no words under it, at the owner's ask ("no need
 *  to have the description, just simple sign in right aligned"). */
function AccountCard({ pilot }: { pilot: Pilot | null }) {
  if (!pilot) {
    return (
      <PillSection
        title="Account" testId="setup-pill-account"
        right={<><Suspense fallback={null}><SignInModal plain /></Suspense><AccountMenu /></>}
      >
        {null}
      </PillSection>
    );
  }
  const name = pilot.fullName || pilot.displayName;
  const initials = name.split(/\s+/).filter(Boolean).map(w => w[0]!).slice(0, 2).join("").toUpperCase();
  return (
    <PillSection title="Account">
    <div role="group" aria-label="Account" className="flex items-center gap-3 rounded-lg border border-border bg-card pr-3" data-testid="setup-pill-account">
      <PageButton page="pilot" testId="pilot-row" label={`${name}: pilot details`}>
        <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground", TEXT.row)}>{initials}</span>
        <span className="flex min-w-0 flex-col text-left">
          <span className={cn("truncate font-semibold", TEXT.row)}>{name}</span>
          {/* The address under the name, where the name is not the address
              itself (a sign-in by email alone names the pilot by it). */}
          <span className={cn("truncate text-muted-foreground", TEXT.note)}>{name === pilot.email ? "Pilot details" : pilot.email}</span>
        </span>
      </PageButton>
      <AccountMenu />
    </div>
    </PillSection>
  );
}

/** The Subscription page's row, with what the pilot has in a few words. */
function SubscriptionRow() {
  const { data: subscription } = useQuery(subscriptionQuery);
  return (
    <PageRow
      page="subscription" title="Subscription" value={subscription ? standing(subscription) : undefined}
      media={<RowBadge colour={SETTING_BADGE.subscription}><Sparkles /></RowBadge>}
    />
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
