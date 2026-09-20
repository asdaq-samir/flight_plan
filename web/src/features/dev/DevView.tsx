import { useCallback, useState } from "react";
import Shell from "../../Shell";
import MapDrawer from "../../components/MapDrawer";
import { PlanLink } from "../../components/PageLinks";
import SidebarToggleButton from "../../components/SidebarToggleButton";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import LabelView from "../label/LabelView";
import { DevButton, DevPanel } from "./DevPanel";

/**
 * The developer's page: the labeling workspace (`LabelView`) on the
 * chart, with the dev console dropping down over it from the top and
 * the waypoint list sliding in from the right -- the same shell, the
 * same two drawers in the same places, as the pilot's Plan page, so
 * switching roles changes what the drawers hold, not where anything
 * is. One drawer at a time over the same chart.
 */
export default function DevView() {
  useDocumentTitle("Dev — VFR Route");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const toggleConsole = useCallback(() => {
    setConsoleOpen(open => !open);
    setSidebarOpen(false);
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebarOpen(open => !open);
    setConsoleOpen(false);
  }, []);

  return (
    <LabelView>
      {({ routeForm, guideButton, zoomButton, mapContent, sidebarContent }) => (
        <Shell
          header={(
            // The same row shape as `TwoRowHeader`'s first row (see its
            // comment) -- a centering grid from `sm` up, a wrapping flex
            // row below it -- with no tabs row: this page has one view.
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] print:hidden">
              <div className="hidden sm:block" />
              {routeForm}
              <div className="ml-auto flex items-center gap-2 sm:ml-0 sm:justify-self-end">
                {guideButton}
                {zoomButton}
                <DevButton open={consoleOpen} onClick={toggleConsole} />
                <SidebarToggleButton open={sidebarOpen} onClick={toggleSidebar} label="Waypoints" />
                <PlanLink />
              </div>
            </header>
          )}
          map={mapContent}
          panels={(
            <MapDrawer side="top" open={consoleOpen} onOpenChange={setConsoleOpen} label="Dev console">
              <DevPanel />
            </MapDrawer>
          )}
          sidebar={sidebarContent}
          sidebarLabel="Waypoints"
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
        />
      )}
    </LabelView>
  );
}
