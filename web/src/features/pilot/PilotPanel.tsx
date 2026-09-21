import type { ComponentProps } from "react";
import { usePreferences } from "../../lib/preferences";
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import IconButton from "../../components/IconButton";
import ThemeToggle from "../../components/ThemeToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
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

const TABS = ["aircraft", "flights", "guide"];

/**
 * The pilot's own drawer, dropping down over the map (see PlanWorkspace):
 * who is signed in and the theme on its top line, then one tab each
 * for their aeroplanes, their filed flights, and the guide to the
 * planner -- the same shape as the developer's drawer, one thing per
 * tab, rather than everything in one long scroll. Not the nav log or
 * the briefing: those are the Flight Planning drawer at the side.
 */
export function PilotPanel({ course }: { course: Course | null }) {
  const {
    data: pilot, isLoading, isError, refetch,
  } = useQuery({ queryKey: ["pilot"], queryFn: api.me, retry: false });
  const pilotState: PilotState = isLoading ? "loading" : (pilot ?? (isError ? "error" : null));
  // The tab the drawer was last on, remembered per browser, the same
  // way the developer's drawer remembers its own.
  const savedTab = usePreferences(s => s.pilotTab);
  const tab = TABS.includes(savedTab) ? savedTab : "aircraft";
  const changeTab = usePreferences(s => s.setPilotTab);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <Tabs value={tab} onValueChange={changeTab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="aircraft">Aircraft</TabsTrigger>
              <TabsTrigger value="flights">Flights</TabsTrigger>
              <TabsTrigger value="guide">Guide</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <SignInStatus pilot={pilotState} onRetry={() => void refetch()} />
              <ThemeToggle />
            </div>
          </div>
          <TabsContent value="aircraft" className="mt-3"><AircraftPanel pilot={pilotState} /></TabsContent>
          <TabsContent value="flights" className="mt-3"><FlightsPanel pilot={pilotState} /></TabsContent>
          <TabsContent value="guide" className="mt-3"><PilotGuide course={course} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
