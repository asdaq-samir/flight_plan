import { CloudSun, Download, Eye, EyeOff, Hexagon, Map as MapIcon, Monitor, Moon, PanelBottom, PanelTop, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ListGroup, ListRow } from "./GroupedList";
import Segmented from "./Segmented";
import TogglePill from "./TogglePill";
import { useNavEdge } from "../hooks/use-nav-edge";
import { keepingAvailable } from "../lib/map/keepRoute";
import { BASE_CHARTS, usePreferences, type BaseChart, type NarrativeFramework, type NavEdge, type RouteColours } from "../lib/preferences";
import { chartQuery } from "../lib/queryClient";
import { MINIMUM_CHOICES, type Minimums } from "../lib/minimums";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/** "09-03-2026", the FAA's cycle as the chart server names it, as "3 Sep
 *  2026"; the cycle as it is where it reads otherwise. */
function editionOf(cycle: string): string {
  const [month, day, year] = cycle.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  return Number.isNaN(date.getTime()) ? cycle : format(date, "d MMM yyyy");
}

/**
 * The settings, the consoles' last tab (ConsoleTabs), laid out the way
 * iOS lays out Settings: a few groups under short headings, each a
 * rounded box of rows with a hairline between them, one label per row
 * with its control at the row's end, one tap each: a segmented control
 * where one of several is picked (Theme, Layout, Chart), a pill of its
 * own, filled while on, for anything on or off (Class B's Weather and
 * TAC, Waypoints, Keep Charts Offline) -- so neither is taken for the
 * other, or for the console's tabs.
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
    <div className="@container/settings space-y-5 pb-1" data-testid="settings-panel">
      <AppearanceGroup />
      <MapGroup />
      <MinimumsGroup />
      <BriefGroup />
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
  const tfrs = usePreferences(s => s.tfrs);
  const setTfrs = usePreferences(s => s.setTfrs);
  const waypoints = usePreferences(s => s.waypoints);
  const setWaypoints = usePreferences(s => s.setWaypoints);
  const keepOffline = usePreferences(s => s.keepOffline);
  const setKeepOffline = usePreferences(s => s.setKeepOffline);
  const available = keepingAvailable();
  // Where the charts come from and which edition is up, under the map's
  // settings: it was a credit in the chart's corner, which the FAA's
  // charts, a US government work, do not ask for. The edition is what a
  // pilot checks: a chart is current for its cycle.
  const { data: chart } = useQuery(chartQuery);
  return (
    <ListGroup
      title="Map"
      footer={chart ? `Charts from the FAA, the ${editionOf(chart.chart_cycle)} edition.` : "Charts from the FAA."}
    >
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
        <div className="flex gap-2" role="group" aria-label="Class B">
          <TogglePill pressed={classB} onPressedChange={setClassB} icon={<CloudSun />} label="Weather" testId="class-b-toggle" />
          {/* TAC, as pilots call the sectional's terminal area chart; its
              IFR counterpart is the area chart. */}
          <TogglePill pressed={tac} onPressedChange={setTac} icon={<MapIcon />} label={base === "sec" ? "TAC" : "Area"} testId="tac-toggle" />
        </div>
      </ListRow>
      {/* The route's waypoints, on either map: the planner's numbered
          checkpoints at every zoom and the dim landmarks they were chosen
          from closer in, the training map's detections; off, the course
          line and its two airports alone. */}
      <ListRow title="Waypoints">
        <TogglePill pressed={waypoints} onPressedChange={setWaypoints} icon={waypoints ? <Eye /> : <EyeOff />} label="Show" testId="waypoints-toggle" />
      </ListRow>
      {/* The temporary flight restrictions, from tfr.faa.gov: on unless
          turned off, as a pilot must know of every one near the route. */}
      <ListRow title="TFRs">
        <TogglePill pressed={tfrs} onPressedChange={setTfrs} icon={tfrs ? <Eye /> : <EyeOff />} label="Show" testId="tfrs-toggle" />
      </ListRow>
      {/* The base chart along each route loaded, held for the air
          (useKeepOffline); how a keep goes is its toast. Over plain http
          there is no service worker to hold it, and it cannot be on. */}
      <ListRow title="Offline">
        <TogglePill
          pressed={keepOffline && available} onPressedChange={setKeepOffline} disabled={!available}
          icon={<Download />} label="Keep charts" testId="keep-offline-toggle"
        />
      </ListRow>
    </ListGroup>
  );
}

/** How each minimum reads in its menu. */
const MINIMUM_ROWS: { key: keyof Minimums; title: string; unit: (n: number) => string }[] = [
  { key: "ceilingFt", title: "Ceiling", unit: n => `${n.toLocaleString()} ft` },
  { key: "visibilitySm", title: "Visibility", unit: n => `${n} sm` },
  { key: "crosswindKt", title: "Crosswind", unit: n => `${n} kt` },
  { key: "windKt", title: "Wind, with gusts", unit: n => `${n} kt` },
];

/** The pilot's personal minimums: the weather they will not take off or
 *  land in, each a menu, Off until picked. The briefing says where the
 *  weather is under them (lib/minimums). */
function MinimumsGroup() {
  const minimums = usePreferences(s => s.minimums);
  const setMinimum = usePreferences(s => s.setMinimum);
  return (
    <ListGroup title="Personal minimums" footer="The briefing says where the weather is under them.">
      {MINIMUM_ROWS.map(({ key, title, unit }) => (
        <ListRow key={key} title={title}>
          <Select value={minimums[key] == null ? "off" : String(minimums[key])} onValueChange={v => setMinimum(key, v === "off" ? null : Number(v))}>
            <SelectTrigger size="sm" aria-label={`Minimum ${title.toLowerCase()}`} data-testid={`minimum-${key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="off">Off</SelectItem>
              {MINIMUM_CHOICES[key].map(n => <SelectItem key={n} value={String(n)}>{unit(n)}</SelectItem>)}
            </SelectContent>
          </Select>
        </ListRow>
      ))}
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

const ROUTE_COLOURS = [
  { value: "airspace", label: "Airspace", icon: <Hexagon /> },
  { value: "metar", label: "Weather", icon: <CloudSun /> },
];

const NARRATIVES = [
  { value: "langgraph", label: "LangGraph" },
  { value: "crewai", label: "CrewAI" },
];

/** Which agent writes the Brief tab's narrative, at the pilot's ask: it
 *  was a switch over the narrative, in the way of reading it. */
function BriefGroup() {
  const narrative = usePreferences(s => s.narrative);
  const setNarrative = usePreferences(s => s.setNarrative);
  return (
    <ListGroup title="Brief" footer="Each narrative is a Claude call, made when the Brief tab opens.">
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

