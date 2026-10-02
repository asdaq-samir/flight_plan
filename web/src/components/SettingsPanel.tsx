import { CloudSun, Eye, EyeOff, Map as MapIcon, Monitor, Moon, PanelBottom, PanelTop, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ListGroup, ListRow } from "./GroupedList";
import Segmented, { SegmentedMany } from "./Segmented";
import { useNavEdge } from "../hooks/use-nav-edge";
import { BASE_CHARTS, usePreferences, type BaseChart, type NavEdge } from "../lib/preferences";

/**
 * The settings, the consoles' last tab (ConsoleTabs), laid out the way
 * iOS lays out Settings: a few groups under short headings, each a
 * rounded box of rows with a hairline between them, one label per row
 * with its control at the row's end. Every control a segmented one, all
 * the choices on show and one tap each: Theme, Layout, Chart and
 * Waypoints pick one; Class B's Weather and TAC are each on or off.
 * Appearance first -- the theme and the layout, the two that change
 * how all of it looks -- then the map. The same on both pages, and
 * remembered per browser.
 *
 * Who is signed in, the role (dev mode) and Sign out are the console's
 * title row (ConsoleHeader); the pilot's own position is the map's
 * location arrow (MyPositionButton), where it was two switches here.
 * The waypoints were the planner's group of their own, a menu of four
 * zoom levels and a switch for the landmarks they were chosen from. It
 * all replaced a column of headings, checkboxes, dropdowns and a
 * paragraph under nearly every control, twice the height.
 */
export default function SettingsPanel() {
  return (
    <div className="space-y-5 pb-1" data-testid="settings-panel">
      <AppearanceGroup />
      <MapGroup />
    </div>
  );
}

function MapGroup() {
  const base = usePreferences(s => s.base);
  const tac = usePreferences(s => s.tac);
  const classB = usePreferences(s => s.classB);
  const setBase = usePreferences(s => s.setBase);
  const setTac = usePreferences(s => s.setTac);
  const setClassB = usePreferences(s => s.setClassB);
  const waypoints = usePreferences(s => s.waypoints);
  const setWaypoints = usePreferences(s => s.setWaypoints);
  return (
    <ListGroup title="Map">
      <ListRow title="Chart">
        <Segmented
          label="Chart" value={base} onChange={v => setBase(v as BaseChart)} testId="base-chart-select"
          options={BASE_CHARTS.map(b => ({ value: b.kind, label: b.label }))}
        />
      </ListRow>
      {/* The Class B airports' two things, on one line: their weather
          now, as chips on the map, and the terminal sheet over the base
          wherever there is one -- the TAC over the sectional, the IFR
          area chart over the IFR charts. Each on or off by itself; they
          were two rows of switches. A chip's card pins its field's
          sheet either way. */}
      <ListRow title="Class B">
        <SegmentedMany
          label="Class B"
          values={[...(classB ? ["weather"] : []), ...(tac ? ["chart"] : [])]}
          onChange={values => { setClassB(values.includes("weather")); setTac(values.includes("chart")); }}
          options={[
            { value: "weather", label: "Weather", icon: <CloudSun />, testId: "class-b-toggle" },
            // TAC, as pilots call the sectional's terminal area chart; its
            // IFR counterpart is the area chart.
            { value: "chart", label: base === "sec" ? "TAC" : "Area", icon: <MapIcon />, testId: "tac-toggle" },
          ]}
        />
      </ListRow>
      {/* The route's waypoints, on either map: the planner's numbered
          checkpoints at every zoom and the dim landmarks they were chosen
          from closer in, the training map's detections; off, the course
          line and its two airports alone. */}
      <ListRow title="Waypoints">
        <Segmented
          label="Waypoints" value={waypoints ? "show" : "hide"} onChange={v => setWaypoints(v === "show")} testId="waypoints-toggle"
          options={[{ value: "show", label: "Show", icon: <Eye /> }, { value: "hide", label: "Hide", icon: <EyeOff /> }]}
        />
      </ListRow>
    </ListGroup>
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
  return (
    <ListGroup title="Appearance">
      <ListRow title="Theme">
        <Segmented label="Theme" value={theme ?? "system"} onChange={setTheme} testId="theme-select" options={THEMES} />
      </ListRow>
      <ListRow title="Layout">
        <Segmented label="Layout" value={edge} onChange={v => setNavBar(v as NavEdge)} testId="nav-bar-select" options={LAYOUTS} />
      </ListRow>
    </ListGroup>
  );
}

