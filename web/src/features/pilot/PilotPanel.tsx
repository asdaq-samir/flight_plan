import type { ComponentProps } from "react";
import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import ConsoleTabs from "../../components/ConsoleTabs";
import IconButton from "../../components/IconButton";
import { api } from "../../lib/api/client";
import type { Course } from "../../lib/api/types";
import { AircraftPanel, FlightsPanel, SignInStatus, type PilotState } from "./AccountPanels";
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
 * who is signed in and the theme on its top line, then one tab each
 * for their aeroplanes, their filed flights, and the guide to the
 * planner. The shape is `ConsoleTabs`, shared with the developer's
 * drawer. Not the nav log or the briefing: those are the Flight
 * Planning drawer at the side.
 */
export function PilotPanel({ course }: { course: Course | null }) {
  const {
    data: pilot, isLoading, isError, refetch,
  } = useQuery({ queryKey: ["pilot"], queryFn: api.me, retry: false });
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));
  const savedTab = usePreferences(s => s.pilotTab);
  const changeTab = usePreferences(s => s.setPilotTab);

  return (
    <ConsoleTabs
      saved={savedTab}
      onChange={changeTab}
      actions={<SignInStatus pilot={pilotState} onRetry={() => void refetch()} />}
      tabs={[
        { value: "aircraft", label: "Aircraft", content: <AircraftPanel pilot={pilotState} /> },
        { value: "flights", label: "Flights", content: <FlightsPanel pilot={pilotState} /> },
        { value: "guide", label: "Guide", content: <PilotGuide course={course} /> },
      ]}
    />
  );
}
