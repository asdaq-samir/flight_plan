import type { ComponentProps } from "react";
import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import ConsoleTabs from "../../components/ConsoleTabs";
import IconButton from "../../components/IconButton";
import { pilotQuery } from "../../lib/queryClient";
import { AircraftPanel, FlightsPanel, type PilotState } from "./AccountPanels";
import PilotGuide from "./PilotGuide";

/** The header button that opens the pilot's console: a `SheetTrigger`
 *  child, so the sheet's own open state, click and `aria-expanded`
 *  arrive as props and land on the button. */
export function PilotButton(props: Omit<ComponentProps<typeof IconButton>, "label" | "children">) {
  return (
    <IconButton label="Pilot" data-testid="pilot-button" {...props}>
      <UserRound className="size-5" />
    </IconButton>
  );
}

/**
 * The pilot's own drawer, dropping down over the map (see PlanWorkspace):
 * the greeting and the way in or out on its top line (ConsoleHeader),
 * the theme beside the tabs, then one tab each
 * for the guide to the planner (first: where a newcomer starts), their
 * aeroplanes and their filed flights. The shape is `ConsoleTabs`, shared with the developer's
 * drawer. Not the nav log or the briefing: those are the Flight
 * Planning drawer at the side.
 */
export function PilotPanel() {
  const { data: pilot, isLoading, isError } = useQuery(pilotQuery);
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));
  const savedTab = usePreferences(s => s.pilotTab);
  const changeTab = usePreferences(s => s.setPilotTab);

  return (
    <ConsoleTabs
      saved={savedTab}
      onChange={changeTab}
      tabs={[
        { value: "guide", label: "Guide", content: <PilotGuide /> },
        { value: "aircraft", label: "Aircraft", content: <AircraftPanel pilot={pilotState} /> },
        { value: "flights", label: "Flights", content: <FlightsPanel pilot={pilotState} /> },
      ]}
    />
  );
}
