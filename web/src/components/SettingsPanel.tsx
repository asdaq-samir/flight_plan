import { useState } from "react";
import { CloudSun, Hexagon, Monitor, Moon, PanelBottom, PanelTop, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ListGroup, ListRow } from "./GroupedList";
import Segmented from "./Segmented";
import { useNavEdge } from "../hooks/use-nav-edge";
import { usePreferences, type NarrativeFramework, type NavEdge, type RouteColours } from "../lib/preferences";
import { LEGAL_PAGES } from "../lib/legal";
import { useTips } from "../lib/tips";

/**
 * The settings, the consoles' last tab (ConsoleTabs), laid out the way
 * iOS lays out Settings: a few groups under short headings, each a
 * rounded box of rows with a hairline between them, one label per row
 * with its control at the row's end, one tap each: a segmented control
 * where one of several is picked (Theme, Layout, Route), so it is not
 * taken for the console's tabs.
 * Appearance first -- the theme and the layout, the two that change
 * how all of it looks -- then the Brief's narrative and the tips. The
 * same on both pages, and remembered per browser. The map's settings
 * are the map's own button's (MapSettings), and the personal minimums
 * the Personal tab's (MinimumsPanel), at the pilot's ask.
 *
 * Who is signed in, the role (dev mode) and Sign out are the console's
 * title row (ConsoleHeader); the pilot's own position is the map's
 * location arrow (MyPositionButton), where it was two switches here.
 * The waypoints were the planner's group of their own, a menu of four
 * zoom levels and a switch for the landmarks they were chosen from. It
 * all replaced a column of headings, checkboxes, dropdowns and a
 * paragraph under nearly every control, twice the height; the last two
 * lines under a group went too, at the pilot's ask: no descriptions.
 */
export default function SettingsPanel() {
  return (
    <div className="@container/settings space-y-5 pb-1" data-testid="settings-panel">
      <AppearanceGroup />
      <BriefGroup />
      <TipsGroup />
      <LegalGroup />
    </div>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

const LAYOUTS = [
  { value: "top", label: "Top", icon: <PanelTop /> },
  { value: "bottom", label: "Bottom", icon: <PanelBottom /> },
];

const ROUTE_COLOURS = [
  { value: "airspace", label: "Airspace", icon: <Hexagon /> },
  { value: "metar", label: "Weather", icon: <CloudSun /> },
];

const NARRATIVES = [
  { value: "langgraph", label: "LangGraph" },
  { value: "crewai", label: "CrewAI" },
];

/** The privacy policy, terms and support pages (lib/legal), which App
 *  Review wants a link to inside the app. */
function LegalGroup() {
  return (
    <ListGroup title="About">
      {LEGAL_PAGES.map(p => <ListRow key={p.key} title={p.title} href={p.href} data-testid={`legal-${p.key}`} />)}
    </ListGroup>
  );
}

/** The first-run tips (lib/tips), offered again from the start. */
function TipsGroup() {
  const reset = useTips(s => s.reset);
  const [asked, setAsked] = useState(false);
  return (
    <ListGroup title="Tips">
      <ListRow
        title={asked ? "Tips will show again" : "Show tips again"} disabled={asked}
        onClick={() => { reset(); setAsked(true); }} data-testid="tips-reset"
      />
    </ListGroup>
  );
}

/** Which agent writes the Brief tab's narrative, at the pilot's ask: it
 *  was a switch over the narrative, in the way of reading it. */
function BriefGroup() {
  const narrative = usePreferences(s => s.narrative);
  const setNarrative = usePreferences(s => s.setNarrative);
  return (
    <ListGroup title="Brief">
      <ListRow title="Narrative">
        <Segmented
          label="Narrative from" value={narrative} onChange={v => setNarrative(v as NarrativeFramework)}
          testId="narrative-framework" options={NARRATIVES}
        />
      </ListRow>
    </ListGroup>
  );
}

/** The theme (next-themes keeps it, and follows the OS on System: a
 *  pilot planning at night wants the page as dim as the panel lights),
 *  and the layout -- the edge the route panel is on, which the sheets
 *  come from too and the map's buttons keep clear of (useNavEdge) --
 *  drawn alike, each choice with its picture. It was "Navigation bar",
 *  in a menu. */
function AppearanceGroup() {
  const { theme, setTheme } = useTheme();
  const edge = useNavEdge();
  const setNavBar = usePreferences(s => s.setNavBar);
  const routeColours = usePreferences(s => s.routeColours);
  const setRouteColours = usePreferences(s => s.setRouteColours);
  return (
    <ListGroup title="Appearance">
      <ListRow title="Theme">
        <Segmented label="Theme" value={theme ?? "system"} onChange={setTheme} testId="theme-select" options={THEMES} />
      </ListRow>
      <ListRow title="Layout">
        <Segmented label="Layout" value={edge} onChange={v => setNavBar(v as NavEdge)} testId="nav-bar-select" options={LAYOUTS} />
      </ListRow>
      {/* The route box's airports by their airspace, as the sectional
          draws it, or by the weather, as the map's chips are. */}
      <ListRow title="Route">
        <Segmented
          label="Route colours" value={routeColours} onChange={v => setRouteColours(v as RouteColours)}
          testId="route-colours-select" options={ROUTE_COLOURS}
        />
      </ListRow>
    </ListGroup>
  );
}

