import { useId, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ListGroup, ListRow } from "./GroupedList";
import Segmented from "./Segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { useNavEdge } from "../hooks/use-nav-edge";
import { ownShipAvailable, useOwnShip } from "../lib/map/ownShip";
import { BASE_CHARTS, MARKER_ZOOMS, usePreferences, type BaseChart, type NavEdge } from "../lib/preferences";

/** What a page adds to the settings: the planner's every-landmark switch
 *  and own ship. The training page adds nothing. */
export interface PageSettings {
  candidates?: { on: boolean; onToggle: (on: boolean) => void };
  ownShip?: boolean;
}

/**
 * The settings, the consoles' last tab (ConsoleTabs), laid out the way
 * iOS lays out Settings: a few groups under short headings, each a
 * rounded box of rows with a hairline between them, one label per row
 * with its control at the row's end, and at most a line of help. A
 * switch for anything on or off; a segmented control where the choices
 * are worth seeing side by side and change often (the chart, the
 * theme); iOS's pop-up menu for a value set once in a while (the zoom
 * level, the navigation bar's edge) -- the two menus had been an
 * outlined field and a segmented control, and the segments squeezed
 * the navigation bar's help to four lines. A row that only means
 * something once another is on is not shown until it is. The account
 * first (`account`, the page's); then the map, what is changed most
 * while planning; the checkpoints, appearance, and the pilot's own
 * position. Everything but the account is remembered per browser. Dev
 * mode was a switch here; it is the Pilot and Developer control in the
 * console's title now (ConsoleHeader).
 *
 * It replaced a column of headings, checkboxes, dropdowns and a
 * paragraph under nearly every control, twice the height, where a
 * two-way choice took two taps in a menu.
 */
export default function SettingsPanel({ page, account }: { page?: PageSettings; account?: ReactNode }) {
  return (
    <div className="space-y-5 pb-1" data-testid="settings-panel">
      {account}
      <MapGroup />
      <CheckpointsGroup candidates={page?.candidates} />
      <AppearanceGroup />
      {page?.ownShip && <PositionGroup />}
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
  const tacId = useId();
  const classBId = useId();
  return (
    <ListGroup title="Map">
      <ListRow title="Chart">
        <Segmented
          label="Chart" value={base} onChange={v => setBase(v as BaseChart)} testId="base-chart-select"
          options={BASE_CHARTS.map(b => ({ value: b.kind, label: b.label }))}
        />
      </ListRow>
      {/* The terminal sheet that belongs over the base: the TAC over the
          sectional, the IFR area chart over the IFR charts. A Class B
          marker's card pins the same thing for its field. */}
      <ListRow id={tacId} title={base === "sec" ? "Terminal area chart" : "IFR area chart"} description="Over the chart wherever there is one">
        <Switch id={tacId} checked={tac} onCheckedChange={setTac} data-testid="tac-toggle" />
      </ListRow>
      <ListRow id={classBId} title="Class B airports" description="Their weather now; tap one for its chart">
        <Switch id={classBId} checked={classB} onCheckedChange={setClassB} data-testid="class-b-toggle" />
      </ListRow>
    </ListGroup>
  );
}

function CheckpointsGroup({ candidates }: { candidates?: PageSettings["candidates"] }) {
  const markerZoom = usePreferences(s => s.markerZoom);
  const setMarkerZoom = usePreferences(s => s.setMarkerZoom);
  const zoomId = useId();
  const allId = useId();
  return (
    <ListGroup title="Checkpoints">
      {/* How far in the map has to be before the markers draw: a long
          route fits the screen zoomed a long way out, where a few
          hundred of them would hide the chart. Named for what it
          sets, the map's zoom level; it was "Show from". A slider was
          tried here, and the menu of four stops kept. */}
      <ListRow id={zoomId} title="Zoom level" description="Zoomed out, markers hide the chart">
        <Select value={String(markerZoom)} onValueChange={value => setMarkerZoom(Number(value))}>
          <SelectTrigger id={zoomId} size="sm" variant="menu" aria-label="Zoom level checkpoints show from" data-testid="marker-zoom-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {MARKER_ZOOMS.map(m => <SelectItem key={m.from} value={String(m.from)}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </ListRow>
      {candidates && (
        <ListRow id={allId} title="Every rated landmark" description="The dim dots the checkpoints were chosen from">
          <Switch id={allId} checked={candidates.on} onCheckedChange={candidates.onToggle} data-testid="candidates-toggle" />
        </ListRow>
      )}
    </ListGroup>
  );
}

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
}

/** Own ship: the phone's position on the chart, and the map kept on it.
 *  The note says what the GPS has, or why there is nothing: no secure
 *  connection (the browser grants geolocation only to https or
 *  localhost), or access refused. Following ends when the pilot pans
 *  the map themselves (RouteMap turns it off on a drag). */
function PositionGroup() {
  const { enabled, follow, fix, error, setEnabled, setFollow } = useOwnShip();
  const available = ownShipAvailable();
  const showId = useId();
  const followId = useId();
  const status = !available
    ? "Needs a secure connection: open the app over https."
    : error ?? (!enabled
      ? "From the phone's GPS, drawn as a blue arrow."
      : !fix
        ? "Waiting for a position…"
        : `${coordinate(fix.lat, "N", "S")} ${coordinate(fix.lon, "E", "W")} · ±${Math.round(fix.accuracyM)} m`
          + (fix.speedKt !== null ? ` · ${Math.round(fix.speedKt)} kt` : "")
          + (fix.headingDeg !== null ? ` · ${String(Math.round(fix.headingDeg)).padStart(3, "0")}°` : ""));
  return (
    <ListGroup title="My position" footer={<span data-testid="own-ship-status">{status}</span>}>
      <ListRow id={showId} title="Show my position">
        <Switch id={showId} checked={enabled} disabled={!available} onCheckedChange={setEnabled} data-testid="own-ship-toggle" />
      </ListRow>
      {/* Only with the position shown, as iOS shows a setting that
          depends on another: it was there all along, a faded switch that
          read as on while nothing was being followed. */}
      {available && enabled && (
        <ListRow id={followId} title="Keep the map on me">
          <Switch id={followId} checked={follow} onCheckedChange={setFollow} data-testid="own-ship-follow" />
        </ListRow>
      )}
    </ListGroup>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

/** The theme (next-themes keeps it, and follows the OS on System: a
 *  pilot planning at night wants the page as dim as the panel lights),
 *  and the edge the route panel is on (useNavEdge). */
function AppearanceGroup() {
  const { theme, setTheme } = useTheme();
  const edge = useNavEdge();
  const setNavBar = usePreferences(s => s.setNavBar);
  const navId = useId();
  return (
    <ListGroup title="Appearance">
      <ListRow title="Theme">
        <Segmented label="Theme" value={theme ?? "system"} onChange={setTheme} testId="theme-select" options={THEMES} />
      </ListRow>
      <ListRow id={navId} title="Navigation bar" description="The route panel and every sheet come from this edge; the map's buttons take the other">
        <Select value={edge} onValueChange={v => setNavBar(v as NavEdge)}>
          <SelectTrigger id={navId} size="sm" variant="menu" aria-label="Navigation bar" data-testid="nav-bar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="bottom">Bottom</SelectItem>
          </SelectContent>
        </Select>
      </ListRow>
    </ListGroup>
  );
}

