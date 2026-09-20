import { useCallback, useState } from "react";
import Shell from "../../Shell";
import DevSwitch from "../../components/DevSwitch";
import MapDrawer from "../../components/MapDrawer";
import MapHeader from "../../components/MapHeader";
import SidebarToggleButton from "../../components/SidebarToggleButton";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import LabelView from "../label/LabelView";
import { DevButton, DevPanel } from "./DevPanel";

/**
 * The developer's page: the labeling workspace (`LabelView`) on the
 * chart, with the dev console dropping down over it from the top and
 * the waypoint list sliding in from the right -- the same shell, the
 * same header, the same two drawers in the same places, as the pilot's
 * Plan page, so switching roles changes what the drawers hold, not
 * where anything is. One drawer at a time over the same chart.
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
            <MapHeader
              dev
              leading={<DevSwitch />}
              form={routeForm}
              actions={(
                <>
                  {guideButton}
                  {zoomButton}
                  <DevButton open={consoleOpen} onClick={toggleConsole} />
                  <SidebarToggleButton open={sidebarOpen} onClick={toggleSidebar} label="Waypoints" />
                </>
              )}
            />
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
