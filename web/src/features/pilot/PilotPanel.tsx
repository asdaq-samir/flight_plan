import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import ConsoleTabs from "../../components/ConsoleTabs";
import { pilotQuery } from "../../lib/queryClient";
import { shortName } from "../../lib/aircraftChoice";
import { AircraftPanel, FlightsPanel, type PilotState } from "./AccountPanels";
import { LogbookPanel } from "./LogbookPanel";
import PilotGuide from "./PilotGuide";

/**
 * The pilot's console, opened from the map's Settings button on the
 * planner (MapPage): one tab each for the guide to the planner (first:
 * where a newcomer starts), their aeroplanes and their filed flights,
 * then the settings. The shape is `ConsoleTabs`, shared with the
 * developer's console. Not the nav log or the briefing: those are the
 * panel over the map.
 */
export function PilotPanel() {
  const { data: pilot, isLoading, isError } = useQuery(pilotQuery);
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));
  const savedTab = usePreferences(s => s.pilotTab);
  const changeTab = usePreferences(s => s.setPilotTab);
  // The aeroplane picked for planning, for a logbook entry's.
  const aircraft = usePreferences(s => s.aircraft);

  return (
    <ConsoleTabs
      saved={savedTab}
      onChange={changeTab}
      tabs={[
        { value: "guide", label: "Guide", content: <PilotGuide /> },
        { value: "aircraft", label: "Aircraft", content: <AircraftPanel pilot={pilotState} /> },
        { value: "flights", label: "Flights", content: <FlightsPanel pilot={pilotState} /> },
        { value: "logbook", label: "Logbook", content: <LogbookPanel pilot={pilotState} aircraft={shortName(aircraft.label)} /> },
      ]}
    />
  );
}
