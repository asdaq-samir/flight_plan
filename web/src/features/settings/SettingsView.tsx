import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";
import Shell from "../../Shell";
import Footer from "../../components/Footer";
import IconButton from "../../components/IconButton";
import SidebarToggleButton from "../../components/SidebarToggleButton";
import TwoRowHeader from "../../components/TwoRowHeader";
import { TabsTrigger } from "../../components/ui/tabs";
import LabelView from "../label/LabelView";
import { AircraftPanel, FlightsPanel, SignInStatus } from "./AccountTab";
import DevMlDrawer from "./DevMlDrawer";
import type { PilotState } from "./shared";
import { api } from "../../lib/api/client";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

/** The Account/Dev triggers -- identical in both of `SettingsView`'s
 *  own two return branches below, so it's pulled out once rather than
 *  copied into each `TwoRowHeader` call. */
const SETTINGS_TABS = (
  <>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="dev">Dev</TabsTrigger>
  </>
);

/** The Map icon standing in for Plan's own Settings gear on row one's
 *  trailing edge. `href` comes from `state.from`, so leaving Settings
 *  lands back on the Map or Brief tab (or Label) a pilot actually came
 *  from rather than always resetting to Plan's default view. */
function SettingsMapLink({ href }: { href: string }) {
  return (
    <IconButton asChild label="Map">
      <Link to={href}>
        <MapIcon className="size-5" />
      </Link>
    </IconButton>
  );
}

/**
 * Everything that isn't the map, in two tabs. Account first and
 * selected by default: a signed-in pilot's own aeroplanes and filed
 * flights, the reason a Settings gear exists. Dev second: the actual
 * `LabelView` workspace, embedded inline the same way Plan's Brief tab
 * swaps in `FlightBriefingView`, with the Model Comparison and
 * Algorithm Picker demos one tap further behind `DevMlDrawer`.
 *
 * Dev gets its own `<Shell>` (a second branch below, not one shared
 * with Account) rather than swapping its map/sidebar into a single
 * Shell's slots the way Plan does -- LabelView owns real map-and-sidebar
 * state (`useLabelState`, a keyboard shortcut listener) that must only
 * run while its tab is active, so it has to mount and unmount with the
 * tab. Ratings in progress do reset if you leave Dev and come back; a
 * real trade-off, accepted because nothing behind it is a billed call
 * or user data.
 *
 * Which tab is active survives leaving this page and coming back
 * (`sessionStorage`) -- the gear that leads here doesn't know which tab
 * a pilot had open last time.
 */
const SETTINGS_TAB_KEY = "settings-tab";

export default function SettingsView() {
  useDocumentTitle("Settings — VFR Route");
  const {
    data: pilot, isLoading, isError: isPilotError, refetch: refetchPilot,
  } = useQuery({ queryKey: ["pilot"], queryFn: api.me });
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isPilotError ? "error" : null));
  const location = useLocation();
  // Where the gear that led here actually was -- the Map or Brief tab,
  // or Label (`SettingsButton`'s own `state.from`). No state at all
  // (Settings opened directly, a bookmark or a fresh tab) falls back to
  // the map.
  const mapHref = (location.state as { from?: string } | null)?.from ?? "/plan";
  const [tab, setTabState] = useState(() => {
    try { return sessionStorage.getItem(SETTINGS_TAB_KEY) ?? "account"; } catch { return "account"; }
  });
  const setTab = useCallback((next: string) => {
    setTabState(next);
    try { sessionStorage.setItem(SETTINGS_TAB_KEY, next); } catch { /* private browsing, storage disabled, etc. */ }
  }, []);
  // The Dev tab's own waypoint-list sidebar -- LabelView's own copy of
  // this same state (used by the standalone `/app/label` route) is a
  // separate instance, not this one; embedded mode never touches it.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (tab === "dev") {
    return (
      <LabelView embedded>
        {({ routeForm, guideButton, zoomButton, mapContent, sidebarContent }) => (
          <Shell
            header={
              <TwoRowHeader
                tab={tab} onTabChange={setTab} tabs={SETTINGS_TABS}
                rowOneStart={routeForm}
                rowOneEnd={<SettingsMapLink href={mapHref} />}
                trailing={(
                  <div className="flex items-center gap-2">
                    {guideButton}
                    {zoomButton}
                    <DevMlDrawer />
                    <SidebarToggleButton open={sidebarOpen} onClick={() => setSidebarOpen(o => !o)} label="Waypoints" />
                  </div>
                )}
              />
            }
            map={mapContent}
            sidebar={sidebarContent}
            sidebarOpen={sidebarOpen}
            onSidebarOpenChange={setSidebarOpen}
          />
        )}
      </LabelView>
    );
  }

  return (
    <Shell
      header={
        <TwoRowHeader
          tab={tab} onTabChange={setTab} tabs={SETTINGS_TABS}
          rowOneStart={<div />}
          rowOneEnd={<SettingsMapLink href={mapHref} />}
          trailing={<SignInStatus pilot={pilotState} onRetry={() => void refetchPilot()} />}
        />
      }
      sidebar={null}
      map={
        // A plain scrolling column, not Shell's usual map -- Shell's
        // layout (header, then one flex-1 region below it) holds this
        // without a change. Footer sits outside the scrolling part on
        // purpose, so it lands in the same place whatever the tab's
        // content height.
        // A plain overflow-y-auto column, not a ScrollArea: Radix's
        // viewport lays its content out as `display: table`, which
        // lets the aircraft table (wider than a phone) grow the whole
        // section card past the screen's edge instead of scrolling
        // inside its own bordered container.
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AircraftPanel pilot={pilotState} />
            <FlightsPanel pilot={pilotState} />
          </div>
          <Footer />
        </div>
      }
    />
  );
}
